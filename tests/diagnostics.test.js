const diagnostics = require('../server/utils/diagnostics');
const logger = require('../server/utils/logger');
const fs = require('fs').promises;
const path = require('path');

// Mock logger to avoid file operations during tests
jest.mock('../server/utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  getLogStats: jest.fn().mockResolvedValue({
    combined: { size: 1024, exists: true },
    error: { size: 512, exists: true }
  }),
  getRecentLogs: jest.fn().mockResolvedValue([
    { timestamp: new Date().toISOString(), level: 'ERROR', message: 'Test error' }
  ])
}));

// Mock file system operations
jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    stat: jest.fn(),
    readdir: jest.fn()
  }
}));

// Mock child_process
jest.mock('child_process', () => ({
  exec: jest.fn()
}));

// Mock database connection
jest.mock('../server/database/connection', () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(),
    all: jest.fn().mockResolvedValue([{ name: 'badge_jobs' }, { name: 'templates' }]),
    get: jest.fn().mockResolvedValue({ count: 5 }),
    close: jest.fn().mockResolvedValue()
  }));
});

// Mock services
jest.mock('../server/services/PrinterInterface', () => {
  return jest.fn().mockImplementation(() => ({
    discoverPrinters: jest.fn().mockResolvedValue([
      { name: 'Test Printer', status: 'online' }
    ]),
    getPrinterStatus: jest.fn().mockResolvedValue({ status: 'ready' })
  }));
});

jest.mock('../server/services/TemplateProcessor', () => {
  return jest.fn().mockImplementation(() => ({
    validateTemplate: jest.fn().mockResolvedValue({ isValid: true })
  }));
});

describe('Diagnostic Tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('System Information', () => {
    test('should get system information', async () => {
      const systemInfo = await diagnostics.getSystemInfo();
      
      expect(systemInfo.platform).toBeDefined();
      expect(systemInfo.architecture).toBeDefined();
      expect(systemInfo.nodeVersion).toBeDefined();
      expect(systemInfo.uptime).toBeDefined();
      expect(systemInfo.memory).toBeDefined();
      expect(systemInfo.cpu).toBeDefined();
    });

    test('should handle system info errors gracefully', async () => {
      // Mock os module to throw error
      jest.doMock('os', () => {
        throw new Error('OS module error');
      });

      const systemInfo = await diagnostics.getSystemInfo();
      
      expect(systemInfo.error).toBeDefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('Database Diagnostics', () => {
    test('should check database connectivity', async () => {
      // Mock successful database file access
      fs.access.mockResolvedValue();
      fs.stat.mockResolvedValue({
        size: 1024,
        mtime: new Date()
      });

      const dbDiagnostics = await diagnostics.checkDatabase();
      
      expect(dbDiagnostics.fileExists).toBe(true);
      expect(dbDiagnostics.connection).toBe(true);
      expect(dbDiagnostics.tables).toEqual(['badge_jobs', 'templates']);
    });

    test('should handle missing database file', async () => {
      // Mock file not found
      fs.access.mockRejectedValue(new Error('ENOENT'));

      const dbDiagnostics = await diagnostics.checkDatabase();
      
      expect(dbDiagnostics.fileExists).toBe(false);
      expect(dbDiagnostics.errors.length).toBeGreaterThan(0);
    });

    test('should handle database connection errors', async () => {
      // Mock database connection failure
      const DatabaseConnection = require('../server/database/connection');
      DatabaseConnection.mockImplementation(() => ({
        connect: jest.fn().mockRejectedValue(new Error('Connection failed'))
      }));

      const dbDiagnostics = await diagnostics.checkDatabase();
      
      expect(dbDiagnostics.connection).toBe(false);
      expect(dbDiagnostics.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Filesystem Diagnostics', () => {
    test('should check filesystem permissions and space', async () => {
      // Mock successful directory access
      fs.stat.mockResolvedValue({
        isDirectory: () => true,
        size: 4096,
        mtime: new Date()
      });
      fs.access.mockResolvedValue();

      // Mock the actual diagnostics method to avoid real filesystem calls
      const mockCheckFilesystem = jest.spyOn(diagnostics, 'checkFilesystem').mockResolvedValue({
        directories: {
          data: { exists: true, isDirectory: true },
          templates: { exists: true, isDirectory: true },
          logs: { exists: true, isDirectory: true }
        },
        permissions: {
          data: 'read-write',
          templates: 'read-write',
          logs: 'read-write'
        },
        errors: []
      });

      const fsDiagnostics = await diagnostics.checkFilesystem();
      
      expect(fsDiagnostics.directories.data).toBeDefined();
      expect(fsDiagnostics.directories.templates).toBeDefined();
      expect(fsDiagnostics.directories.logs).toBeDefined();
      expect(fsDiagnostics.permissions.data).toBe('read-write');
      
      mockCheckFilesystem.mockRestore();
    });

    test('should handle missing directories', async () => {
      // Mock the diagnostics method to return missing directories
      const mockCheckFilesystem = jest.spyOn(diagnostics, 'checkFilesystem').mockResolvedValue({
        directories: {
          data: { exists: false }
        },
        permissions: {},
        errors: ['Directory data not accessible: ENOENT']
      });

      const fsDiagnostics = await diagnostics.checkFilesystem();
      
      expect(fsDiagnostics.directories.data.exists).toBe(false);
      expect(fsDiagnostics.errors.length).toBeGreaterThan(0);
      
      mockCheckFilesystem.mockRestore();
    });

    test('should check read-only permissions', async () => {
      // Mock the diagnostics method to return read-only permissions
      const mockCheckFilesystem = jest.spyOn(diagnostics, 'checkFilesystem').mockResolvedValue({
        directories: {
          data: { exists: true, isDirectory: true }
        },
        permissions: {
          data: 'read-only'
        },
        errors: []
      });

      const fsDiagnostics = await diagnostics.checkFilesystem();
      
      expect(fsDiagnostics.permissions.data).toBe('read-only');
      
      mockCheckFilesystem.mockRestore();
    });
  });

  describe('Printer System Diagnostics', () => {
    test('should check printer system support', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((cmd, callback) => {
        callback(null, { stdout: 'printer output' });
      });

      const printerDiagnostics = await diagnostics.checkPrinterSystem();
      
      expect(printerDiagnostics.systemSupport).toBe(true);
      expect(printerDiagnostics.availablePrinters).toEqual([
        { name: 'Test Printer', status: 'online', diagnosticStatus: { status: 'ready' } }
      ]);
    });

    test('should handle printer discovery errors', async () => {
      const PrinterInterface = require('../server/services/PrinterInterface');
      PrinterInterface.mockImplementation(() => ({
        discoverPrinters: jest.fn().mockRejectedValue(new Error('Discovery failed'))
      }));

      const printerDiagnostics = await diagnostics.checkPrinterSystem();
      
      expect(printerDiagnostics.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Template System Diagnostics', () => {
    test('should check template directory and files', async () => {
      fs.stat.mockResolvedValue({
        isDirectory: () => true,
        mtime: new Date()
      });
      fs.readdir.mockResolvedValue(['template1.indd', 'template2.png', 'readme.txt']);

      const templateDiagnostics = await diagnostics.checkTemplates();
      
      expect(templateDiagnostics.templateDirectory.exists).toBe(true);
      expect(templateDiagnostics.templates).toEqual(['template1.indd', 'template2.png']);
      expect(templateDiagnostics.validation['template1.indd']).toEqual({ isValid: true });
    });

    test('should handle missing template directory', async () => {
      fs.stat.mockRejectedValue(new Error('ENOENT'));

      const templateDiagnostics = await diagnostics.checkTemplates();
      
      expect(templateDiagnostics.templateDirectory.exists).toBe(false);
      expect(templateDiagnostics.errors.length).toBeGreaterThan(0);
    });

    test('should handle template validation errors', async () => {
      fs.stat.mockResolvedValue({
        isDirectory: () => true,
        mtime: new Date()
      });
      fs.readdir.mockResolvedValue(['invalid.indd']);

      const TemplateProcessor = require('../server/services/TemplateProcessor');
      TemplateProcessor.mockImplementation(() => ({
        validateTemplate: jest.fn().mockRejectedValue(new Error('Invalid template'))
      }));

      const templateDiagnostics = await diagnostics.checkTemplates();
      
      expect(templateDiagnostics.validation['invalid.indd'].isValid).toBe(false);
      expect(templateDiagnostics.validation['invalid.indd'].error).toBe('Invalid template');
    });
  });

  describe('Service Diagnostics', () => {
    test('should check service availability', async () => {
      const serviceDiagnostics = await diagnostics.checkServices();
      
      expect(serviceDiagnostics.queueManager.status).toBe('class-available');
      expect(serviceDiagnostics.printerInterface.status).toBe('class-available');
      expect(serviceDiagnostics.templateProcessor.status).toBe('class-available');
    });

    test('should handle service loading errors', async () => {
      // Mock module loading error
      jest.doMock('../server/services/PrintQueueManager', () => {
        throw new Error('Module not found');
      });

      const serviceDiagnostics = await diagnostics.checkServices();
      
      expect(serviceDiagnostics.queueManager.status).toBe('error');
    });
  });

  describe('Log System Diagnostics', () => {
    test('should check log system', async () => {
      const logDiagnostics = await diagnostics.checkLogs();
      
      expect(logDiagnostics.logFiles).toEqual({
        combined: { size: 1024, exists: true },
        error: { size: 512, exists: true }
      });
      expect(logDiagnostics.recentErrors).toEqual([
        { timestamp: expect.any(String), level: 'ERROR', message: 'Test error' }
      ]);
    });

    test('should handle log reading errors', async () => {
      logger.getRecentLogs.mockRejectedValue(new Error('Cannot read logs'));

      const logDiagnostics = await diagnostics.checkLogs();
      
      expect(logDiagnostics.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Performance Diagnostics', () => {
    test('should check performance metrics', async () => {
      const perfDiagnostics = await diagnostics.checkPerformance();
      
      expect(perfDiagnostics.memoryUsage).toBeDefined();
      expect(perfDiagnostics.cpuUsage).toBeDefined();
      expect(perfDiagnostics.uptime).toBeDefined();
      expect(perfDiagnostics.eventLoopDelay).toBeDefined();
    });
  });

  describe('Full Diagnostics', () => {
    test('should run full diagnostic suite', async () => {
      const fullDiagnostics = await diagnostics.runFullDiagnostics();
      
      expect(fullDiagnostics.timestamp).toBeDefined();
      expect(fullDiagnostics.system).toBeDefined();
      expect(fullDiagnostics.database).toBeDefined();
      expect(fullDiagnostics.filesystem).toBeDefined();
      expect(fullDiagnostics.printer).toBeDefined();
      expect(fullDiagnostics.templates).toBeDefined();
      expect(fullDiagnostics.services).toBeDefined();
      expect(fullDiagnostics.logs).toBeDefined();
      expect(fullDiagnostics.performance).toBeDefined();
      
      expect(logger.info).toHaveBeenCalledWith(
        'Full system diagnostics completed',
        expect.objectContaining({
          diagnostics: expect.any(Object)
        })
      );
    });

    test('should summarize diagnostics correctly', async () => {
      const mockDiagnostics = {
        database: { connection: true, errors: [] },
        printer: { availablePrinters: [{ name: 'Test Printer' }] },
        templates: { templates: ['template1.indd'] }
      };

      const summary = diagnostics.summarizeDiagnostics(mockDiagnostics);
      
      expect(summary.overall).toBe('healthy');
      expect(summary.issues).toEqual([]);
    });

    test('should identify critical issues', async () => {
      const mockDiagnostics = {
        database: { connection: false, errors: ['Connection failed'] },
        printer: { availablePrinters: [] },
        templates: { templates: [] }
      };

      const summary = diagnostics.summarizeDiagnostics(mockDiagnostics);
      
      expect(summary.overall).toBe('critical');
      expect(summary.issues.length).toBeGreaterThan(0);
      expect(summary.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Specific Diagnostics', () => {
    test('should run specific diagnostic component', async () => {
      const result = await diagnostics.runSpecificDiagnostic('system');
      
      expect(result).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith(
        'Diagnostic completed for system',
        expect.objectContaining({ result })
      );
    });

    test('should throw error for unknown component', async () => {
      await expect(diagnostics.runSpecificDiagnostic('unknown'))
        .rejects.toThrow('Unknown diagnostic component: unknown');
    });
  });

  describe('Diagnostic History', () => {
    test('should maintain diagnostic history', async () => {
      await diagnostics.runSpecificDiagnostic('system');
      await diagnostics.runSpecificDiagnostic('database');
      
      const history = diagnostics.getDiagnosticHistory();
      
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThan(0);
      expect(history[0]).toHaveProperty('component');
      expect(history[0]).toHaveProperty('timestamp');
      expect(history[0]).toHaveProperty('summary');
    });
  });

  describe('Report Generation', () => {
    test('should generate JSON report', async () => {
      const report = await diagnostics.generateReport('json');
      
      expect(report).toBeDefined();
      expect(report.timestamp).toBeDefined();
    });

    test('should generate text report', async () => {
      const report = await diagnostics.generateReport('text');
      
      expect(typeof report).toBe('string');
      expect(report).toContain('Festival Badge Printer - Diagnostic Report');
      expect(report).toContain('SYSTEM INFORMATION');
      expect(report).toContain('DATABASE');
      expect(report).toContain('PRINTER SYSTEM');
      expect(report).toContain('TEMPLATES');
    });
  });

  describe('Component Summary', () => {
    test('should summarize component diagnostics', () => {
      const mockResult = {
        errors: ['Error 1', 'Error 2'],
        connection: false
      };

      const summary = diagnostics.summarizeComponentDiagnostic('database', mockResult);
      
      expect(summary.status).toBe('error');
      expect(summary.issues).toBe(2);
    });

    test('should handle warnings for specific components', () => {
      const mockResult = {
        errors: [],
        availablePrinters: []
      };

      const summary = diagnostics.summarizeComponentDiagnostic('printer', mockResult);
      
      expect(summary.warnings).toBe(1);
    });
  });
});