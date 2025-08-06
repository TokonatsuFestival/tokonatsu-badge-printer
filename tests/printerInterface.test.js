const PrinterInterface = require('../server/services/PrinterInterface');
const { exec } = require('child_process');
const fs = require('fs').promises;
const pdfToPrinter = require('pdf-to-printer');

// Mock dependencies
jest.mock('child_process');
jest.mock('fs', () => ({
  promises: {
    access: jest.fn()
  }
}));
jest.mock('pdf-to-printer');

describe('PrinterInterface', () => {
  let printerInterface;
  let mockExec;

  beforeEach(() => {
    printerInterface = new PrinterInterface();
    mockExec = jest.fn();
    exec.mockImplementation((command, callback) => {
      mockExec(command, callback);
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    printerInterface.disconnect();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      expect(printerInterface.connectedPrinters).toBeInstanceOf(Map);
      expect(printerInterface.selectedPrinter).toBeNull();
      expect(printerInterface.presets).toBeInstanceOf(Map);
      expect(printerInterface.statusCheckInterval).toBeNull();
    });

    it('should load default presets', () => {
      const presets = printerInterface.getAvailablePresets();
      expect(presets).toHaveLength(3);
      expect(presets.map(p => p.name)).toContain('Default Badge');
      expect(presets.map(p => p.name)).toContain('High Quality');
      expect(presets.map(p => p.name)).toContain('Fast Print');
    });
  });

  describe('discoverPrinters', () => {
    it('should discover printers on macOS', async () => {
      // Mock platform
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true
      });

      // Mock lpstat output
      mockExec.mockImplementation((command, callback) => {
        if (command === 'lpstat -p') {
          callback(null, { stdout: 'printer HP_LaserJet is idle\nprinter Canon_Printer is idle' });
        } else if (command.startsWith('lpstat -p ')) {
          callback(null, { stdout: 'printer HP_LaserJet is idle' });
        }
      });

      const printers = await printerInterface.discoverPrinters();

      expect(printers).toHaveLength(2);
      expect(printers[0]).toMatchObject({
        id: 'HP_LaserJet',
        name: 'HP_LaserJet',
        isConnected: true,
        type: 'USB',
        platform: 'darwin'
      });
    });

    it('should discover printers on Linux', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      });

      mockExec.mockImplementation((command, callback) => {
        if (command === 'lpstat -p') {
          callback(null, { stdout: 'printer Brother_Printer is idle' });
        } else if (command.startsWith('lpstat -p ')) {
          callback(null, { stdout: 'printer Brother_Printer is idle' });
        }
      });

      const printers = await printerInterface.discoverPrinters();

      expect(printers).toHaveLength(1);
      expect(printers[0]).toMatchObject({
        id: 'Brother_Printer',
        name: 'Brother_Printer',
        platform: 'linux'
      });
    });

    it('should discover printers on Windows', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true
      });

      mockExec.mockImplementation((command, callback) => {
        if (command === 'wmic printer get name,status /format:csv') {
          callback(null, { 
            stdout: 'Node,Name,Status\n,HP LaserJet,OK\n,Canon Printer,Ready\n' 
          });
        }
      });

      const printers = await printerInterface.discoverPrinters();

      expect(printers).toHaveLength(2);
      expect(printers[0]).toMatchObject({
        id: 'HP LaserJet',
        name: 'HP LaserJet',
        isConnected: true,
        platform: 'win32'
      });
    });

    it('should handle discovery errors gracefully', async () => {
      // Mock platform to ensure we test the main discoverPrinters method error handling
      Object.defineProperty(process, 'platform', {
        value: 'unsupported',
        configurable: true
      });

      mockExec.mockImplementation((command, callback) => {
        callback(new Error('Command failed'));
      });

      await expect(printerInterface.discoverPrinters()).rejects.toThrow('Failed to discover printers');
    });

    it('should handle platform-specific discovery errors gracefully', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true
      });

      mockExec.mockImplementation((command, callback) => {
        callback(new Error('Command failed'));
      });

      const printers = await printerInterface.discoverPrinters();
      expect(printers).toHaveLength(0);
    });

    it('should return empty array when no printers found', async () => {
      mockExec.mockImplementation((command, callback) => {
        callback(null, { stdout: '' });
      });

      const printers = await printerInterface.discoverPrinters();
      expect(printers).toHaveLength(0);
    });
  });

  describe('connectToPrinter', () => {
    beforeEach(async () => {
      // Setup mock printers
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true
      });

      mockExec.mockImplementation((command, callback) => {
        if (command === 'lpstat -p') {
          callback(null, { stdout: 'printer TestPrinter is idle' });
        } else if (command.startsWith('lpstat -p ')) {
          callback(null, { stdout: 'printer TestPrinter is idle' });
        }
      });

      await printerInterface.discoverPrinters();
    });

    it('should connect to an available printer', async () => {
      const result = await printerInterface.connectToPrinter('TestPrinter');

      expect(result).toBe(true);
      expect(printerInterface.selectedPrinter).toBeTruthy();
      expect(printerInterface.selectedPrinter.id).toBe('TestPrinter');
    });

    it('should throw error for non-existent printer', async () => {
      await expect(printerInterface.connectToPrinter('NonExistentPrinter'))
        .rejects.toThrow('Printer NonExistentPrinter not found');
    });

    it('should throw error for disconnected printer', async () => {
      // Mock a disconnected printer
      printerInterface.connectedPrinters.set('DisconnectedPrinter', {
        id: 'DisconnectedPrinter',
        name: 'DisconnectedPrinter',
        isConnected: false
      });

      await expect(printerInterface.connectToPrinter('DisconnectedPrinter'))
        .rejects.toThrow('Printer DisconnectedPrinter is not available');
    });
  });

  describe('getPrinterStatus', () => {
    it('should return no printer selected status when no printer connected', async () => {
      const status = await printerInterface.getPrinterStatus();

      expect(status).toMatchObject({
        isConnected: false,
        status: 'No printer selected',
        printerId: null
      });
    });

    it('should return printer status for connected printer', async () => {
      // Setup connected printer
      printerInterface.selectedPrinter = {
        id: 'TestPrinter',
        name: 'TestPrinter',
        platform: 'darwin'
      };

      mockExec.mockImplementation((command, callback) => {
        callback(null, { stdout: 'printer TestPrinter is idle' });
      });

      const status = await printerInterface.getPrinterStatus();

      expect(status).toMatchObject({
        isConnected: true,
        status: 'Ready',
        printerId: 'TestPrinter',
        printerName: 'TestPrinter'
      });
    });

    it('should handle status check errors', async () => {
      printerInterface.selectedPrinter = {
        id: 'TestPrinter',
        name: 'TestPrinter',
        platform: 'darwin'
      };

      mockExec.mockImplementation((command, callback) => {
        callback(new Error('Status check failed'));
      });

      const status = await printerInterface.getPrinterStatus();

      expect(status).toMatchObject({
        isConnected: false,
        status: 'Error',
        printerId: 'TestPrinter'
      });
    });
  });

  describe('printDocument', () => {
    beforeEach(() => {
      printerInterface.selectedPrinter = {
        id: 'TestPrinter',
        name: 'TestPrinter'
      };
      fs.access.mockResolvedValue();
      pdfToPrinter.print.mockResolvedValue();
    });

    it('should print document with default preset', async () => {
      const result = await printerInterface.printDocument('/path/to/document.pdf');

      expect(result).toBe(true);
      expect(pdfToPrinter.print).toHaveBeenCalledWith('/path/to/document.pdf', {
        printer: 'TestPrinter',
        paperSize: 'A4',
        orientation: 'portrait',
        scale: 'fit',
        copies: 1
      });
    });

    it('should print document with specified preset', async () => {
      const result = await printerInterface.printDocument('/path/to/document.pdf', 'high-quality');

      expect(result).toBe(true);
      expect(pdfToPrinter.print).toHaveBeenCalledWith('/path/to/document.pdf', {
        printer: 'TestPrinter',
        paperSize: 'A4',
        orientation: 'portrait',
        scale: 'fit',
        copies: 1,
        quality: 'high'
      });
    });

    it('should throw error when no printer selected', async () => {
      printerInterface.selectedPrinter = null;

      await expect(printerInterface.printDocument('/path/to/document.pdf'))
        .rejects.toThrow('No printer selected');
    });

    it('should throw error when document not found', async () => {
      fs.access.mockRejectedValue(new Error('File not found'));

      await expect(printerInterface.printDocument('/path/to/nonexistent.pdf'))
        .rejects.toThrow('Document not found');
    });

    it('should throw error for invalid preset', async () => {
      await expect(printerInterface.printDocument('/path/to/document.pdf', 'invalid-preset'))
        .rejects.toThrow('Preset not found: invalid-preset');
    });

    it('should handle printing errors', async () => {
      pdfToPrinter.print.mockRejectedValue(new Error('Printer error'));

      await expect(printerInterface.printDocument('/path/to/document.pdf'))
        .rejects.toThrow('Failed to print document');
    });
  });

  describe('applyPresets', () => {
    it('should return preset configuration', () => {
      const preset = printerInterface.applyPresets('default');

      expect(preset).toMatchObject({
        name: 'Default Badge',
        description: 'Standard badge printing settings',
        options: {
          paperSize: 'A4',
          orientation: 'portrait',
          scale: 'fit',
          copies: 1
        }
      });
    });

    it('should throw error for invalid preset', () => {
      expect(() => printerInterface.applyPresets('invalid-preset'))
        .toThrow('Preset not found: invalid-preset');
    });
  });

  describe('getAvailablePresets', () => {
    it('should return all available presets', () => {
      const presets = printerInterface.getAvailablePresets();

      expect(presets).toHaveLength(3);
      expect(presets.map(p => p.name)).toEqual([
        'Default Badge',
        'High Quality',
        'Fast Print'
      ]);
    });
  });

  describe('status monitoring', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should start status monitoring when connecting to printer', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true
      });

      mockExec.mockImplementation((command, callback) => {
        if (command === 'lpstat -p') {
          callback(null, { stdout: 'printer TestPrinter is idle' });
        } else if (command.startsWith('lpstat -p ')) {
          callback(null, { stdout: 'printer TestPrinter is idle' });
        }
      });

      await printerInterface.discoverPrinters();
      await printerInterface.connectToPrinter('TestPrinter');

      expect(printerInterface.statusCheckInterval).toBeTruthy();
    });

    it('should stop status monitoring on disconnect', async () => {
      printerInterface.statusCheckInterval = setInterval(() => {}, 1000);
      
      printerInterface.disconnect();

      expect(printerInterface.statusCheckInterval).toBeNull();
      expect(printerInterface.selectedPrinter).toBeNull();
    });
  });

  describe('platform-specific status checks', () => {
    it('should parse macOS printer status correctly', async () => {
      printerInterface.selectedPrinter = {
        id: 'TestPrinter',
        platform: 'darwin'
      };

      mockExec.mockImplementation((command, callback) => {
        callback(null, { stdout: 'printer TestPrinter is printing' });
      });

      const status = await printerInterface.getPrinterStatus();
      expect(status.status).toBe('Printing');
    });

    it('should handle disabled printer status', async () => {
      printerInterface.selectedPrinter = {
        id: 'TestPrinter',
        platform: 'darwin'
      };

      mockExec.mockImplementation((command, callback) => {
        callback(null, { stdout: 'printer TestPrinter disabled since Mon 01 Jan' });
      });

      const status = await printerInterface.getPrinterStatus();
      expect(status.status).toBe('Offline');
      expect(status.isConnected).toBe(false);
    });
  });
});