const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const pdfToPrinter = require('pdf-to-printer');

const execAsync = promisify(exec);

/**
 * PrinterInterface class handles USB printer communication and management
 * Provides methods for printer discovery, connection, status monitoring, and printing
 */
class PrinterInterface {
  constructor() {
    this.connectedPrinters = new Map();
    this.selectedPrinter = null;
    this.presets = new Map();
    this.statusCheckInterval = null;
    
    // Load default presets
    this.loadDefaultPresets();
  }

  /**
   * Discover available USB printers on the system
   * @returns {Promise<Array>} Array of discovered printer objects
   */
  async discoverPrinters() {
    try {
      let printers = [];
      
      // Try different methods based on the operating system
      if (process.platform === 'darwin') {
        // macOS - use lpstat command
        printers = await this.discoverPrintersMacOS();
      } else if (process.platform === 'linux') {
        // Linux - use lpstat or cups commands
        printers = await this.discoverPrintersLinux();
      } else if (process.platform === 'win32') {
        // Windows - use wmic command
        printers = await this.discoverPrintersWindows();
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      // Update connected printers map
      this.connectedPrinters.clear();
      printers.forEach(printer => {
        this.connectedPrinters.set(printer.id, printer);
      });

      return printers;
    } catch (error) {
      console.error('Error discovering printers:', error);
      throw new Error(`Failed to discover printers: ${error.message}`);
    }
  }

  /**
   * Discover printers on macOS using lpstat
   * @private
   */
  async discoverPrintersMacOS() {
    try {
      const { stdout } = await execAsync('lpstat -p');
      const printers = [];
      
      const lines = stdout.split('\n').filter(line => line.startsWith('printer'));
      
      for (const line of lines) {
        const match = line.match(/printer (\S+)/);
        if (match) {
          const printerId = match[1];
          const status = await this.getPrinterStatusMacOS(printerId);
          
          printers.push({
            id: printerId,
            name: printerId,
            isConnected: status.isConnected,
            status: status.status,
            type: 'USB', // Assume USB for now
            platform: 'darwin'
          });
        }
      }
      
      return printers;
    } catch (error) {
      console.warn('lpstat command failed, returning empty printer list');
      return [];
    }
  }

  /**
   * Discover printers on Linux using lpstat
   * @private
   */
  async discoverPrintersLinux() {
    try {
      const { stdout } = await execAsync('lpstat -p');
      const printers = [];
      
      const lines = stdout.split('\n').filter(line => line.startsWith('printer'));
      
      for (const line of lines) {
        const match = line.match(/printer (\S+)/);
        if (match) {
          const printerId = match[1];
          const status = await this.getPrinterStatusLinux(printerId);
          
          printers.push({
            id: printerId,
            name: printerId,
            isConnected: status.isConnected,
            status: status.status,
            type: 'USB',
            platform: 'linux'
          });
        }
      }
      
      return printers;
    } catch (error) {
      console.warn('lpstat command failed, returning empty printer list');
      return [];
    }
  }

  /**
   * Discover printers on Windows using wmic
   * @private
   */
  async discoverPrintersWindows() {
    try {
      const { stdout } = await execAsync('wmic printer get name,status /format:csv');
      const printers = [];
      
      const lines = stdout.split('\n').slice(1); // Skip header
      
      for (const line of lines) {
        const parts = line.split(',');
        if (parts.length >= 3 && parts[1]) {
          const name = parts[1].trim();
          const status = parts[2] ? parts[2].trim() : 'Unknown';
          
          printers.push({
            id: name,
            name: name,
            isConnected: status.toLowerCase().includes('ok') || status.toLowerCase().includes('ready'),
            status: status,
            type: 'USB',
            platform: 'win32'
          });
        }
      }
      
      return printers;
    } catch (error) {
      console.warn('wmic command failed, returning empty printer list');
      return [];
    }
  }

  /**
   * Get printer status on macOS
   * @private
   */
  async getPrinterStatusMacOS(printerId) {
    try {
      const { stdout } = await execAsync(`lpstat -p ${printerId}`);
      const isConnected = !stdout.includes('disabled') && !stdout.includes('not accepting');
      const status = stdout.includes('idle') ? 'Ready' : 
                   stdout.includes('printing') ? 'Printing' : 
                   stdout.includes('disabled') ? 'Offline' : 'Unknown';
      
      return { isConnected, status };
    } catch (error) {
      return { isConnected: false, status: 'Error' };
    }
  }

  /**
   * Get printer status on Linux
   * @private
   */
  async getPrinterStatusLinux(printerId) {
    try {
      const { stdout } = await execAsync(`lpstat -p ${printerId}`);
      const isConnected = !stdout.includes('disabled') && !stdout.includes('not accepting');
      const status = stdout.includes('idle') ? 'Ready' : 
                   stdout.includes('printing') ? 'Printing' : 
                   stdout.includes('disabled') ? 'Offline' : 'Unknown';
      
      return { isConnected, status };
    } catch (error) {
      return { isConnected: false, status: 'Error' };
    }
  }

  /**
   * Connect to a specific printer
   * @param {string} printerId - The printer ID to connect to
   * @returns {Promise<boolean>} Success status
   */
  async connectToPrinter(printerId) {
    try {
      const printer = this.connectedPrinters.get(printerId);
      if (!printer) {
        throw new Error(`Printer ${printerId} not found`);
      }

      if (!printer.isConnected) {
        throw new Error(`Printer ${printerId} is not available`);
      }

      this.selectedPrinter = printer;
      
      // Start status monitoring
      this.startStatusMonitoring();
      
      return true;
    } catch (error) {
      console.error('Error connecting to printer:', error);
      throw error;
    }
  }

  /**
   * Get the status of the currently selected printer
   * @returns {Promise<Object>} Printer status object
   */
  async getPrinterStatus() {
    if (!this.selectedPrinter) {
      return {
        isConnected: false,
        status: 'No printer selected',
        printerId: null
      };
    }

    try {
      let status;
      
      if (this.selectedPrinter.platform === 'darwin') {
        status = await this.getPrinterStatusMacOS(this.selectedPrinter.id);
      } else if (this.selectedPrinter.platform === 'linux') {
        status = await this.getPrinterStatusLinux(this.selectedPrinter.id);
      } else {
        // For Windows or fallback
        status = { isConnected: true, status: 'Ready' };
      }

      return {
        ...status,
        printerId: this.selectedPrinter.id,
        printerName: this.selectedPrinter.name
      };
    } catch (error) {
      console.error('Error getting printer status:', error);
      return {
        isConnected: false,
        status: 'Error',
        printerId: this.selectedPrinter.id,
        error: error.message
      };
    }
  }

  /**
   * Print a document using the selected printer and preset
   * @param {string} documentPath - Path to the document to print
   * @param {string} presetName - Name of the preset to use
   * @returns {Promise<boolean>} Success status
   */
  async printDocument(documentPath, presetName = 'default') {
    if (!this.selectedPrinter) {
      throw new Error('No printer selected');
    }

    if (!await this.fileExists(documentPath)) {
      throw new Error(`Document not found: ${documentPath}`);
    }

    const preset = this.presets.get(presetName);
    if (!preset) {
      throw new Error(`Preset not found: ${presetName}`);
    }

    try {
      const options = {
        printer: this.selectedPrinter.name,
        ...preset.options
      };

      await pdfToPrinter.print(documentPath, options);
      return true;
    } catch (error) {
      console.error('Error printing document:', error);
      throw new Error(`Failed to print document: ${error.message}`);
    }
  }

  /**
   * Load and apply a preset configuration
   * @param {string} presetName - Name of the preset to apply
   * @returns {Object} The loaded preset configuration
   */
  applyPresets(presetName) {
    const preset = this.presets.get(presetName);
    if (!preset) {
      throw new Error(`Preset not found: ${presetName}`);
    }

    return preset;
  }

  /**
   * Get all available presets
   * @returns {Array} Array of preset names and configurations
   */
  getAvailablePresets() {
    return Array.from(this.presets.entries()).map(([name, config]) => ({
      name,
      ...config
    }));
  }

  /**
   * Load default printer presets
   * @private
   */
  loadDefaultPresets() {
    // Default badge printing preset
    this.presets.set('default', {
      name: 'Default Badge',
      description: 'Standard badge printing settings',
      options: {
        paperSize: 'A4',
        orientation: 'portrait',
        scale: 'fit',
        copies: 1
      }
    });

    // High quality preset
    this.presets.set('high-quality', {
      name: 'High Quality',
      description: 'High quality badge printing',
      options: {
        paperSize: 'A4',
        orientation: 'portrait',
        scale: 'fit',
        copies: 1,
        quality: 'high'
      }
    });

    // Fast printing preset
    this.presets.set('fast', {
      name: 'Fast Print',
      description: 'Fast badge printing for high volume',
      options: {
        paperSize: 'A4',
        orientation: 'portrait',
        scale: 'fit',
        copies: 1,
        quality: 'draft'
      }
    });
  }

  /**
   * Start monitoring printer status
   * @private
   */
  startStatusMonitoring() {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }

    this.statusCheckInterval = setInterval(async () => {
      try {
        await this.getPrinterStatus();
      } catch (error) {
        console.error('Status monitoring error:', error);
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Stop monitoring printer status
   */
  stopStatusMonitoring() {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
      this.statusCheckInterval = null;
    }
  }

  /**
   * Check if a file exists
   * @private
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Disconnect from current printer and cleanup
   */
  disconnect() {
    this.stopStatusMonitoring();
    this.selectedPrinter = null;
    this.connectedPrinters.clear();
  }
}

module.exports = PrinterInterface;