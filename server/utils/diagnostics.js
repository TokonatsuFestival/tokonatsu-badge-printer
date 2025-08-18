const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const logger = require('./logger');

const execAsync = promisify(exec);

/**
 * Comprehensive diagnostic tools for troubleshooting system issues
 */
class DiagnosticTools {
  constructor() {
    this.diagnosticResults = new Map();
  }

  /**
   * Run comprehensive system diagnostics
   */
  async runFullDiagnostics() {
    const diagnostics = {
      timestamp: new Date().toISOString(),
      system: await this.getSystemInfo(),
      database: await this.checkDatabase(),
      filesystem: await this.checkFilesystem(),
      printer: await this.checkPrinterSystem(),
      templates: await this.checkTemplates(),
      services: await this.checkServices(),
      logs: await this.checkLogs(),
      performance: await this.checkPerformance()
    };

    // Store results
    this.diagnosticResults.set('full', diagnostics);

    // Log diagnostic summary
    await logger.info('Full system diagnostics completed', {
      diagnostics: this.summarizeDiagnostics(diagnostics)
    });

    return diagnostics;
  }

  /**
   * Get system information
   */
  async getSystemInfo() {
    try {
      const os = require('os');
      
      return {
        platform: process.platform,
        architecture: process.arch,
        nodeVersion: process.version,
        uptime: process.uptime(),
        memory: {
          total: os.totalmem(),
          free: os.freemem(),
          used: process.memoryUsage()
        },
        cpu: {
          model: os.cpus()[0]?.model || 'Unknown',
          cores: os.cpus().length,
          loadAverage: os.loadavg()
        },
        hostname: os.hostname(),
        networkInterfaces: os.networkInterfaces()
      };
    } catch (error) {
      await logger.error('Failed to get system info', { error });
      return { error: error.message };
    }
  }

  /**
   * Check database connectivity and integrity
   */
  async checkDatabase() {
    const results = {
      connection: false,
      tables: [],
      integrity: false,
      performance: null,
      errors: []
    };

    try {
      // Check if database file exists
      const dbPath = path.join(__dirname, '../../data/festival_badges.db');
      
      try {
        await fs.access(dbPath);
        results.fileExists = true;
        
        const stats = await fs.stat(dbPath);
        results.fileSize = stats.size;
        results.lastModified = stats.mtime;
      } catch (error) {
        results.fileExists = false;
        results.errors.push(`Database file not found: ${dbPath}`);
      }

      // Test database connection
      const DatabaseConnection = require('../database/connection');
      const db = new DatabaseConnection();
      
      try {
        await db.connect();
        results.connection = true;

        // Check tables exist
        const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
        results.tables = tables.map(t => t.name);

        // Check table integrity
        for (const table of results.tables) {
          try {
            await db.get(`SELECT COUNT(*) as count FROM ${table}`);
          } catch (error) {
            results.errors.push(`Table ${table} integrity check failed: ${error.message}`);
          }
        }

        // Performance test
        const start = Date.now();
        await db.get('SELECT 1');
        results.performance = Date.now() - start;

        results.integrity = results.errors.length === 0;

        await db.close();
      } catch (error) {
        results.errors.push(`Database connection failed: ${error.message}`);
      }

    } catch (error) {
      results.errors.push(`Database check failed: ${error.message}`);
    }

    return results;
  }

  /**
   * Check filesystem permissions and space
   */
  async checkFilesystem() {
    const results = {
      permissions: {},
      diskSpace: null,
      directories: {},
      errors: []
    };

    try {
      // Check critical directories
      const directories = [
        { name: 'data', path: path.join(__dirname, '../../data') },
        { name: 'templates', path: path.join(__dirname, '../../templates') },
        { name: 'logs', path: path.join(__dirname, '../../logs') },
        { name: 'temp', path: path.join(__dirname, '../../data/temp') }
      ];

      for (const dir of directories) {
        try {
          const stats = await fs.stat(dir.path);
          results.directories[dir.name] = {
            exists: true,
            isDirectory: stats.isDirectory(),
            size: stats.size,
            lastModified: stats.mtime
          };

          // Check read/write permissions
          try {
            await fs.access(dir.path, fs.constants.R_OK | fs.constants.W_OK);
            results.permissions[dir.name] = 'read-write';
          } catch {
            try {
              await fs.access(dir.path, fs.constants.R_OK);
              results.permissions[dir.name] = 'read-only';
            } catch {
              results.permissions[dir.name] = 'no-access';
            }
          }
        } catch (error) {
          results.directories[dir.name] = { exists: false };
          results.errors.push(`Directory ${dir.name} not accessible: ${error.message}`);
        }
      }

      // Check disk space (Unix-like systems)
      if (process.platform !== 'win32') {
        try {
          const { stdout } = await execAsync('df -h .');
          results.diskSpace = stdout.split('\n')[1]?.split(/\s+/) || null;
        } catch (error) {
          results.errors.push(`Disk space check failed: ${error.message}`);
        }
      }

    } catch (error) {
      results.errors.push(`Filesystem check failed: ${error.message}`);
    }

    return results;
  }

  /**
   * Check printer system and connectivity
   */
  async checkPrinterSystem() {
    const results = {
      systemSupport: false,
      availablePrinters: [],
      selectedPrinter: null,
      connectivity: {},
      errors: []
    };

    try {
      // Check if printer commands are available
      const commands = {
        'lpstat': 'lpstat -p',
        'lpr': 'which lpr',
        'cups': 'lpstat -r'
      };

      for (const [name, command] of Object.entries(commands)) {
        try {
          await execAsync(command);
          results.systemSupport = true;
          results.connectivity[name] = 'available';
        } catch (error) {
          results.connectivity[name] = 'not-available';
        }
      }

      // Discover printers
      const PrinterInterface = require('../services/PrinterInterface');
      const printerInterface = new PrinterInterface();
      
      try {
        results.availablePrinters = await printerInterface.discoverPrinters();
        
        // Test connectivity to each printer
        for (const printer of results.availablePrinters) {
          try {
            const status = await printerInterface.getPrinterStatus();
            printer.diagnosticStatus = status;
          } catch (error) {
            printer.diagnosticStatus = { error: error.message };
          }
        }
      } catch (error) {
        results.errors.push(`Printer discovery failed: ${error.message}`);
      }

    } catch (error) {
      results.errors.push(`Printer system check failed: ${error.message}`);
    }

    return results;
  }

  /**
   * Check template system and files
   */
  async checkTemplates() {
    const results = {
      templateDirectory: null,
      templates: [],
      validation: {},
      errors: []
    };

    try {
      const templateDir = path.join(__dirname, '../../templates');
      
      // Check template directory
      try {
        const stats = await fs.stat(templateDir);
        results.templateDirectory = {
          exists: true,
          isDirectory: stats.isDirectory(),
          lastModified: stats.mtime
        };

        // List template files
        const files = await fs.readdir(templateDir);
        results.templates = files.filter(file => 
          ['.indd', '.png', '.jpg', '.jpeg', '.pdf'].includes(path.extname(file).toLowerCase())
        );

        // Validate each template
        const TemplateProcessor = require('../services/TemplateProcessor');
        const templateProcessor = new TemplateProcessor();

        for (const templateFile of results.templates) {
          const templatePath = path.join(templateDir, templateFile);
          try {
            const validation = await templateProcessor.validateTemplate(templatePath);
            results.validation[templateFile] = validation;
          } catch (error) {
            results.validation[templateFile] = {
              isValid: false,
              error: error.message
            };
          }
        }

      } catch (error) {
        results.templateDirectory = { exists: false };
        results.errors.push(`Template directory not accessible: ${error.message}`);
      }

    } catch (error) {
      results.errors.push(`Template check failed: ${error.message}`);
    }

    return results;
  }

  /**
   * Check service status and health
   */
  async checkServices() {
    const results = {
      queueManager: null,
      printerInterface: null,
      templateProcessor: null,
      database: null,
      errors: []
    };

    try {
      // This would typically check if services are properly initialized
      // For now, we'll check if the classes can be instantiated
      
      try {
        const PrintQueueManager = require('../services/PrintQueueManager');
        results.queueManager = { status: 'class-available' };
      } catch (error) {
        results.queueManager = { status: 'error', error: error.message };
      }

      try {
        const PrinterInterface = require('../services/PrinterInterface');
        results.printerInterface = { status: 'class-available' };
      } catch (error) {
        results.printerInterface = { status: 'error', error: error.message };
      }

      try {
        const TemplateProcessor = require('../services/TemplateProcessor');
        results.templateProcessor = { status: 'class-available' };
      } catch (error) {
        results.templateProcessor = { status: 'error', error: error.message };
      }

    } catch (error) {
      results.errors.push(`Service check failed: ${error.message}`);
    }

    return results;
  }

  /**
   * Check log system and recent errors
   */
  async checkLogs() {
    const results = {
      logDirectory: null,
      logFiles: {},
      recentErrors: [],
      errors: []
    };

    try {
      const logStats = await logger.getLogStats();
      results.logFiles = logStats;

      // Get recent errors
      try {
        const recentLogs = await logger.getRecentLogs('error', 10);
        results.recentErrors = recentLogs;
      } catch (error) {
        results.errors.push(`Failed to read recent errors: ${error.message}`);
      }

    } catch (error) {
      results.errors.push(`Log check failed: ${error.message}`);
    }

    return results;
  }

  /**
   * Check system performance metrics
   */
  async checkPerformance() {
    const results = {
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      uptime: process.uptime(),
      eventLoopDelay: null,
      errors: []
    };

    try {
      // Measure event loop delay
      const start = process.hrtime.bigint();
      await new Promise(resolve => setImmediate(resolve));
      const end = process.hrtime.bigint();
      results.eventLoopDelay = Number(end - start) / 1000000; // Convert to milliseconds

    } catch (error) {
      results.errors.push(`Performance check failed: ${error.message}`);
    }

    return results;
  }

  /**
   * Run specific diagnostic for a component
   */
  async runSpecificDiagnostic(component) {
    const diagnosticMethods = {
      'system': this.getSystemInfo,
      'database': this.checkDatabase,
      'filesystem': this.checkFilesystem,
      'printer': this.checkPrinterSystem,
      'templates': this.checkTemplates,
      'services': this.checkServices,
      'logs': this.checkLogs,
      'performance': this.checkPerformance
    };

    const method = diagnosticMethods[component];
    if (!method) {
      throw new Error(`Unknown diagnostic component: ${component}`);
    }

    const result = await method.call(this);
    this.diagnosticResults.set(component, result);

    await logger.info(`Diagnostic completed for ${component}`, { result });

    return result;
  }

  /**
   * Get diagnostic history
   */
  getDiagnosticHistory() {
    return Array.from(this.diagnosticResults.entries()).map(([component, result]) => ({
      component,
      timestamp: result.timestamp || new Date().toISOString(),
      summary: this.summarizeComponentDiagnostic(component, result)
    }));
  }

  /**
   * Summarize diagnostic results
   */
  summarizeDiagnostics(diagnostics) {
    const summary = {
      overall: 'healthy',
      issues: [],
      warnings: []
    };

    // Check each component
    Object.entries(diagnostics).forEach(([component, result]) => {
      if (result.errors && result.errors.length > 0) {
        summary.overall = 'issues';
        summary.issues.push(...result.errors.map(error => `${component}: ${error}`));
      }
    });

    // Check specific conditions
    if (!diagnostics.database?.connection) {
      summary.overall = 'critical';
      summary.issues.push('Database connection failed');
    }

    if (diagnostics.printer?.availablePrinters?.length === 0) {
      summary.warnings.push('No printers detected');
    }

    if (diagnostics.templates?.templates?.length === 0) {
      summary.warnings.push('No templates found');
    }

    return summary;
  }

  /**
   * Summarize individual component diagnostic
   */
  summarizeComponentDiagnostic(component, result) {
    const summary = { status: 'ok', issues: 0, warnings: 0 };

    if (result.errors && result.errors.length > 0) {
      summary.status = 'error';
      summary.issues = result.errors.length;
    }

    // Component-specific checks
    switch (component) {
      case 'database':
        if (!result.connection) summary.status = 'error';
        break;
      case 'printer':
        if (result.availablePrinters?.length === 0) summary.warnings++;
        break;
      case 'templates':
        if (result.templates?.length === 0) summary.warnings++;
        break;
    }

    return summary;
  }

  /**
   * Generate diagnostic report
   */
  async generateReport(format = 'json') {
    const diagnostics = await this.runFullDiagnostics();
    
    if (format === 'text') {
      return this.formatTextReport(diagnostics);
    }
    
    return diagnostics;
  }

  /**
   * Format diagnostic results as text report
   */
  formatTextReport(diagnostics) {
    const lines = [];
    lines.push('Festival Badge Printer - Diagnostic Report');
    lines.push('=' .repeat(50));
    lines.push(`Generated: ${diagnostics.timestamp}`);
    lines.push('');

    // System info
    lines.push('SYSTEM INFORMATION');
    lines.push('-'.repeat(20));
    lines.push(`Platform: ${diagnostics.system.platform} (${diagnostics.system.architecture})`);
    lines.push(`Node.js: ${diagnostics.system.nodeVersion}`);
    lines.push(`Uptime: ${Math.floor(diagnostics.system.uptime / 60)} minutes`);
    lines.push('');

    // Database
    lines.push('DATABASE');
    lines.push('-'.repeat(20));
    lines.push(`Connection: ${diagnostics.database.connection ? 'OK' : 'FAILED'}`);
    lines.push(`Tables: ${diagnostics.database.tables.join(', ')}`);
    if (diagnostics.database.errors.length > 0) {
      lines.push('Errors:');
      diagnostics.database.errors.forEach(error => lines.push(`  - ${error}`));
    }
    lines.push('');

    // Printer
    lines.push('PRINTER SYSTEM');
    lines.push('-'.repeat(20));
    lines.push(`System Support: ${diagnostics.printer.systemSupport ? 'YES' : 'NO'}`);
    lines.push(`Available Printers: ${diagnostics.printer.availablePrinters.length}`);
    diagnostics.printer.availablePrinters.forEach(printer => {
      lines.push(`  - ${printer.name} (${printer.status})`);
    });
    lines.push('');

    // Templates
    lines.push('TEMPLATES');
    lines.push('-'.repeat(20));
    lines.push(`Template Directory: ${diagnostics.templates.templateDirectory?.exists ? 'EXISTS' : 'MISSING'}`);
    lines.push(`Template Files: ${diagnostics.templates.templates.length}`);
    diagnostics.templates.templates.forEach(template => {
      const validation = diagnostics.templates.validation[template];
      lines.push(`  - ${template} (${validation?.isValid ? 'VALID' : 'INVALID'})`);
    });
    lines.push('');

    return lines.join('\n');
  }
}

// Create singleton instance
const diagnostics = new DiagnosticTools();

module.exports = diagnostics;