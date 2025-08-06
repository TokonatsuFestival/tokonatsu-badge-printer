const fs = require('fs');
const path = require('path');

/**
 * Comprehensive logging utility for the Festival Badge Printer system
 * Provides structured logging with different levels and output destinations
 */
class Logger {
  constructor(options = {}) {
    this.logLevel = options.logLevel || process.env.LOG_LEVEL || 'info';
    this.logDir = options.logDir || path.join(__dirname, '../../logs');
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile !== false;
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.maxFiles = options.maxFiles || 5;
    
    // Log levels (higher number = more verbose)
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      trace: 4
    };
    
    // Initialize log directory
    this.initializeLogDirectory();
    
    // Current log files
    this.logFiles = {
      error: path.join(this.logDir, 'error.log'),
      combined: path.join(this.logDir, 'combined.log'),
      access: path.join(this.logDir, 'access.log'),
      printer: path.join(this.logDir, 'printer.log'),
      template: path.join(this.logDir, 'template.log'),
      queue: path.join(this.logDir, 'queue.log')
    };
  }

  /**
   * Initialize log directory and ensure it exists
   */
  initializeLogDirectory() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create log directory:', error.message);
    }
  }

  /**
   * Check if a log level should be logged based on current log level
   */
  shouldLog(level) {
    return this.levels[level] <= this.levels[this.logLevel];
  }

  /**
   * Format log entry with timestamp and metadata
   */
  formatLogEntry(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const pid = process.pid;
    
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      pid,
      message,
      ...meta
    };

    // Add stack trace for errors
    if (level === 'error' && meta.error instanceof Error) {
      logEntry.stack = meta.error.stack;
      logEntry.errorName = meta.error.name;
      logEntry.errorMessage = meta.error.message;
    }

    return logEntry;
  }

  /**
   * Write log entry to console
   */
  writeToConsole(logEntry) {
    if (!this.enableConsole) return;

    const { timestamp, level, message, ...meta } = logEntry;
    const colorCodes = {
      ERROR: '\x1b[31m', // Red
      WARN: '\x1b[33m',  // Yellow
      INFO: '\x1b[36m',  // Cyan
      DEBUG: '\x1b[35m', // Magenta
      TRACE: '\x1b[37m'  // White
    };
    const resetCode = '\x1b[0m';
    
    const color = colorCodes[level] || '';
    const consoleMessage = `${color}[${timestamp}] ${level}${resetCode} ${message}`;
    
    if (level === 'ERROR') {
      console.error(consoleMessage);
      if (meta.stack) {
        console.error(meta.stack);
      }
    } else if (level === 'WARN') {
      console.warn(consoleMessage);
    } else {
      console.log(consoleMessage);
    }

    // Log additional metadata if present
    const metaKeys = Object.keys(meta).filter(key => 
      !['stack', 'errorName', 'errorMessage', 'pid'].includes(key)
    );
    if (metaKeys.length > 0) {
      const metaObj = {};
      metaKeys.forEach(key => metaObj[key] = meta[key]);
      console.log('  Meta:', JSON.stringify(metaObj, null, 2));
    }
  }

  /**
   * Write log entry to file
   */
  async writeToFile(logEntry, category = 'combined') {
    if (!this.enableFile) return;

    try {
      const logFile = this.logFiles[category] || this.logFiles.combined;
      
      // Check file size and rotate if necessary
      await this.rotateLogFileIfNeeded(logFile);
      
      const logLine = JSON.stringify(logEntry) + '\n';
      await fs.promises.appendFile(logFile, logLine);
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }

  /**
   * Rotate log file if it exceeds maximum size
   */
  async rotateLogFileIfNeeded(logFile) {
    try {
      const stats = await fs.promises.stat(logFile);
      if (stats.size > this.maxFileSize) {
        await this.rotateLogFile(logFile);
      }
    } catch (error) {
      // File doesn't exist yet, which is fine
      if (error.code !== 'ENOENT') {
        console.error('Error checking log file size:', error.message);
      }
    }
  }

  /**
   * Rotate log file by renaming with timestamp
   */
  async rotateLogFile(logFile) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedFile = logFile.replace('.log', `-${timestamp}.log`);
      
      await fs.promises.rename(logFile, rotatedFile);
      
      // Clean up old rotated files
      await this.cleanupOldLogFiles(path.dirname(logFile), path.basename(logFile, '.log'));
    } catch (error) {
      console.error('Error rotating log file:', error.message);
    }
  }

  /**
   * Clean up old rotated log files
   */
  async cleanupOldLogFiles(logDir, baseName) {
    try {
      const files = await fs.promises.readdir(logDir);
      const rotatedFiles = files
        .filter(file => file.startsWith(baseName) && file.includes('-') && file.endsWith('.log'))
        .map(file => ({
          name: file,
          path: path.join(logDir, file),
          stat: fs.statSync(path.join(logDir, file))
        }))
        .sort((a, b) => b.stat.mtime - a.stat.mtime);

      // Keep only the most recent files
      const filesToDelete = rotatedFiles.slice(this.maxFiles);
      for (const file of filesToDelete) {
        await fs.promises.unlink(file.path);
      }
    } catch (error) {
      console.error('Error cleaning up old log files:', error.message);
    }
  }

  /**
   * Log error message
   */
  async error(message, meta = {}) {
    if (!this.shouldLog('error')) return;
    
    const logEntry = this.formatLogEntry('error', message, meta);
    this.writeToConsole(logEntry);
    await this.writeToFile(logEntry, 'error');
    await this.writeToFile(logEntry, 'combined');
  }

  /**
   * Log warning message
   */
  async warn(message, meta = {}) {
    if (!this.shouldLog('warn')) return;
    
    const logEntry = this.formatLogEntry('warn', message, meta);
    this.writeToConsole(logEntry);
    await this.writeToFile(logEntry, 'combined');
  }

  /**
   * Log info message
   */
  async info(message, meta = {}) {
    if (!this.shouldLog('info')) return;
    
    const logEntry = this.formatLogEntry('info', message, meta);
    this.writeToConsole(logEntry);
    await this.writeToFile(logEntry, 'combined');
  }

  /**
   * Log debug message
   */
  async debug(message, meta = {}) {
    if (!this.shouldLog('debug')) return;
    
    const logEntry = this.formatLogEntry('debug', message, meta);
    this.writeToConsole(logEntry);
    await this.writeToFile(logEntry, 'combined');
  }

  /**
   * Log trace message
   */
  async trace(message, meta = {}) {
    if (!this.shouldLog('trace')) return;
    
    const logEntry = this.formatLogEntry('trace', message, meta);
    this.writeToConsole(logEntry);
    await this.writeToFile(logEntry, 'combined');
  }

  /**
   * Log HTTP access
   */
  async access(req, res, responseTime) {
    const logEntry = this.formatLogEntry('info', 'HTTP Request', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip || req.connection.remoteAddress,
      contentLength: res.get('Content-Length') || 0
    });
    
    this.writeToConsole(logEntry);
    await this.writeToFile(logEntry, 'access');
    await this.writeToFile(logEntry, 'combined');
  }

  /**
   * Log printer-related events
   */
  async printer(message, meta = {}) {
    const logEntry = this.formatLogEntry('info', message, { category: 'printer', ...meta });
    this.writeToConsole(logEntry);
    await this.writeToFile(logEntry, 'printer');
    await this.writeToFile(logEntry, 'combined');
  }

  /**
   * Log template-related events
   */
  async template(message, meta = {}) {
    const logEntry = this.formatLogEntry('info', message, { category: 'template', ...meta });
    this.writeToConsole(logEntry);
    await this.writeToFile(logEntry, 'template');
    await this.writeToFile(logEntry, 'combined');
  }

  /**
   * Log queue-related events
   */
  async queue(message, meta = {}) {
    const logEntry = this.formatLogEntry('info', message, { category: 'queue', ...meta });
    this.writeToConsole(logEntry);
    await this.writeToFile(logEntry, 'queue');
    await this.writeToFile(logEntry, 'combined');
  }

  /**
   * Get log statistics
   */
  async getLogStats() {
    const stats = {};
    
    for (const [category, filePath] of Object.entries(this.logFiles)) {
      try {
        const stat = await fs.promises.stat(filePath);
        stats[category] = {
          size: stat.size,
          lastModified: stat.mtime,
          exists: true
        };
      } catch (error) {
        stats[category] = {
          size: 0,
          lastModified: null,
          exists: false
        };
      }
    }
    
    return stats;
  }

  /**
   * Get recent log entries from a specific category
   */
  async getRecentLogs(category = 'combined', lines = 100) {
    try {
      const logFile = this.logFiles[category];
      if (!logFile || !fs.existsSync(logFile)) {
        return [];
      }

      const content = await fs.promises.readFile(logFile, 'utf8');
      const logLines = content.trim().split('\n').slice(-lines);
      
      return logLines
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return { message: line, timestamp: new Date().toISOString(), level: 'UNKNOWN' };
          }
        });
    } catch (error) {
      console.error('Error reading log file:', error.message);
      return [];
    }
  }
}

// Create singleton logger instance
const logger = new Logger();

module.exports = logger;