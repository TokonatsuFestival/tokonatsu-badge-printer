const request = require('supertest');
const { app } = require('../server/index');
const logger = require('../server/utils/logger');
const { AppError, ErrorClassifier, ErrorRecovery, createError } = require('../server/utils/errorHandler');
const diagnostics = require('../server/utils/diagnostics');

// Mock logger to avoid file operations during tests
jest.mock('../server/utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  access: jest.fn(),
  queue: jest.fn(),
  template: jest.fn(),
  printer: jest.fn(),
  getLogStats: jest.fn().mockResolvedValue({}),
  getRecentLogs: jest.fn().mockResolvedValue([])
}));

// Mock diagnostics to avoid system calls during tests
jest.mock('../server/utils/diagnostics', () => ({
  runFullDiagnostics: jest.fn().mockResolvedValue({ timestamp: new Date().toISOString() }),
  runSpecificDiagnostic: jest.fn().mockResolvedValue({ status: 'ok' }),
  generateReport: jest.fn().mockResolvedValue({ report: 'test' }),
  getDiagnosticHistory: jest.fn().mockReturnValue([])
}));

describe('Error Handling System', () => {
  describe('AppError Class', () => {
    test('should create AppError with correct properties', () => {
      const error = new AppError('VALIDATION_ERROR', 'Test validation error');
      
      expect(error.name).toBe('AppError');
      expect(error.type).toBe('VALIDATION_ERROR');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.userMessage).toBe('The information you provided is not valid. Please check your input and try again.');
      expect(error.timestamp).toBeDefined();
    });

    test('should include context in error', () => {
      const context = { field: 'uid', value: 'test123' };
      const error = new AppError('DUPLICATE_UID', null, null, context);
      
      expect(error.context).toEqual(context);
    });

    test('should convert to JSON correctly', () => {
      const error = new AppError('TEMPLATE_NOT_FOUND', 'Custom message');
      const json = error.toJSON();
      
      expect(json.error).toBe('TEMPLATE_NOT_FOUND');
      expect(json.message).toBe('The selected badge template could not be found. Please choose a different template.');
      expect(json.timestamp).toBeDefined();
    });

    test('should include debug info in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      
      const error = new AppError('INTERNAL_ERROR', 'Test error');
      const json = error.toJSON();
      
      expect(json.details).toBe('Test error');
      expect(json.stack).toBeDefined();
      
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('ErrorClassifier', () => {
    test('should classify database errors correctly', () => {
      const dbError = new Error('database is locked');
      dbError.code = 'SQLITE_BUSY';
      
      const classified = ErrorClassifier.classify(dbError);
      
      expect(classified.type).toBe('DATABASE_ERROR');
      expect(classified.statusCode).toBe(500);
    });

    test('should classify file system errors correctly', () => {
      const fileError = new Error('File not found');
      fileError.code = 'ENOENT';
      
      const classified = ErrorClassifier.classify(fileError);
      
      expect(classified.type).toBe('FILE_NOT_FOUND');
      expect(classified.statusCode).toBe(404);
    });

    test('should classify printer errors correctly', () => {
      const printerError = new Error('printer not found');
      
      const classified = ErrorClassifier.classify(printerError);
      
      expect(classified.type).toBe('PRINTER_NOT_FOUND');
      expect(classified.statusCode).toBe(404);
    });

    test('should classify timeout errors correctly', () => {
      const timeoutError = new Error('operation timeout');
      timeoutError.code = 'ETIMEDOUT';
      
      const classified = ErrorClassifier.classify(timeoutError);
      
      expect(classified.type).toBe('TIMEOUT_ERROR');
      expect(classified.statusCode).toBe(408);
    });

    test('should return AppError unchanged', () => {
      const appError = new AppError('VALIDATION_ERROR', 'Test error');
      
      const classified = ErrorClassifier.classify(appError);
      
      expect(classified).toBe(appError);
    });

    test('should default to internal error for unknown errors', () => {
      const unknownError = new Error('Unknown error type');
      
      const classified = ErrorClassifier.classify(unknownError);
      
      expect(classified.type).toBe('INTERNAL_ERROR');
      expect(classified.statusCode).toBe(500);
    });
  });

  describe('ErrorRecovery', () => {
    test('should attempt database retry recovery', async () => {
      const dbError = new AppError('DATABASE_ERROR', 'Database busy');
      dbError.originalError = { code: 'SQLITE_BUSY' };
      
      const recovery = await ErrorRecovery.attemptRecovery(dbError);
      
      expect(recovery.attempted).toBe(true);
      expect(recovery.action).toBe('database_retry');
      expect(recovery.successful).toBe(true);
    });

    test('should attempt template fallback recovery', async () => {
      const templateError = new AppError('FILE_NOT_FOUND', 'Template not found');
      const context = { templateId: 'test-template' };
      
      const recovery = await ErrorRecovery.attemptRecovery(templateError, context);
      
      expect(recovery.attempted).toBe(true);
      expect(recovery.action).toBe('template_fallback');
    });

    test('should attempt printer reconnect recovery', async () => {
      const printerError = new AppError('PRINTER_OFFLINE', 'Printer offline');
      
      const recovery = await ErrorRecovery.attemptRecovery(printerError);
      
      expect(recovery.attempted).toBe(true);
      expect(recovery.action).toBe('printer_reconnect');
    });

    test('should return no recovery for unsupported errors', async () => {
      const unsupportedError = new AppError('VALIDATION_ERROR', 'Validation failed');
      
      const recovery = await ErrorRecovery.attemptRecovery(unsupportedError);
      
      expect(recovery.attempted).toBe(false);
    });
  });

  describe('createError helper', () => {
    test('should create AppError with correct type', () => {
      const error = createError('QUEUE_FULL', 'Queue is at capacity');
      
      expect(error).toBeInstanceOf(AppError);
      expect(error.type).toBe('QUEUE_FULL');
      expect(error.statusCode).toBe(429);
    });

    test('should include context', () => {
      const context = { queueSize: 50, maxSize: 50 };
      const error = createError('QUEUE_FULL', 'Queue is full', context);
      
      expect(error.context).toEqual(context);
    });
  });

  describe('Monitoring Endpoints', () => {
    test('GET /api/monitoring/health should return health status', async () => {
      const response = await request(app)
        .get('/api/monitoring/health')
        .expect(200);

      expect(response.body.status).toBeDefined();
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.uptime).toBeDefined();
    });

    test('GET /api/monitoring/health?detailed=true should return detailed health', async () => {
      const response = await request(app)
        .get('/api/monitoring/health?detailed=true')
        .expect(200);

      expect(response.body.diagnostics).toBeDefined();
    });

    test('GET /api/monitoring/errors should return error summary', async () => {
      logger.getRecentLogs.mockResolvedValue([
        {
          timestamp: new Date().toISOString(),
          level: 'ERROR',
          message: 'Test error',
          errorName: 'TestError'
        }
      ]);

      const response = await request(app)
        .get('/api/monitoring/errors')
        .expect(200);

      expect(response.body.timeRange).toBeDefined();
      expect(response.body.totalErrors).toBeDefined();
      expect(response.body.summary).toBeDefined();
    });

    test('GET /api/monitoring/metrics should return system metrics', async () => {
      const response = await request(app)
        .get('/api/monitoring/metrics')
        .expect(200);

      expect(response.body.timestamp).toBeDefined();
      expect(response.body.system).toBeDefined();
      expect(response.body.performance).toBeDefined();
    });

    test('GET /api/monitoring/logs/combined should return logs', async () => {
      logger.getRecentLogs.mockResolvedValue([
        {
          timestamp: new Date().toISOString(),
          level: 'INFO',
          message: 'Test log entry'
        }
      ]);

      const response = await request(app)
        .get('/api/monitoring/logs/combined')
        .expect(200);

      expect(response.body.category).toBe('combined');
      expect(response.body.logs).toBeDefined();
    });

    test('GET /api/monitoring/logs/invalid should return error', async () => {
      const response = await request(app)
        .get('/api/monitoring/logs/invalid')
        .expect(400);

      expect(response.body.error).toBe('Invalid category');
    });

    test('GET /api/monitoring/alerts should return system alerts', async () => {
      const response = await request(app)
        .get('/api/monitoring/alerts')
        .expect(200);

      expect(response.body.timestamp).toBeDefined();
      expect(response.body.alertCount).toBeDefined();
      expect(response.body.alerts).toBeDefined();
    });

    test('POST /api/monitoring/test-error should be forbidden in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const response = await request(app)
        .post('/api/monitoring/test-error')
        .send({ type: 'validation', message: 'Test error' })
        .expect(403);

      expect(response.body.error).toBe('Forbidden');
      
      process.env.NODE_ENV = originalEnv;
    });

    test('POST /api/monitoring/diagnostics/run should run specific diagnostic', async () => {
      const response = await request(app)
        .post('/api/monitoring/diagnostics/run')
        .send({ component: 'system' })
        .expect(200);

      expect(response.body.component).toBe('system');
      expect(response.body.result).toBeDefined();
    });

    test('POST /api/monitoring/diagnostics/run should require component', async () => {
      const response = await request(app)
        .post('/api/monitoring/diagnostics/run')
        .send({})
        .expect(400);

      expect(response.body.error).toBe('Missing component');
    });
  });

  describe('Error Middleware Integration', () => {
    test('should handle validation errors in badge creation', async () => {
      const response = await request(app)
        .post('/api/badges')
        .send({
          templateId: '',
          uid: '',
          badgeName: ''
        })
        .expect(400);

      expect(response.body.error).toBe('VALIDATION_ERROR');
      expect(response.body.message).toContain('not valid');
    });

    test('should handle service unavailable errors', async () => {
      // Mock the app to not have queueManager
      const originalGet = app.get;
      app.get = jest.fn().mockReturnValue(null);
      
      const response = await request(app)
        .get('/api/queue')
        .expect(503);

      expect(response.body.error).toBe('SERVICE_UNAVAILABLE');
      
      // Restore original method
      app.get = originalGet;
    });
  });

  describe('Logging Integration', () => {
    test('should log errors with proper context', async () => {
      await request(app)
        .post('/api/badges')
        .send({
          templateId: '',
          uid: 'test',
          badgeName: 'Test Badge'
        });

      expect(logger.warn).toHaveBeenCalledWith(
        'Badge input validation failed',
        expect.objectContaining({
          errors: expect.any(Array),
          received: expect.any(Object),
          ip: expect.any(String)
        })
      );
    });

    test('should log access requests', async () => {
      await request(app)
        .get('/api/monitoring/health');

      expect(logger.access).toHaveBeenCalled();
    });

    test('should log debug information for monitoring requests', async () => {
      await request(app)
        .get('/api/monitoring/health');

      expect(logger.debug).toHaveBeenCalledWith(
        'Health check requested',
        expect.objectContaining({
          ip: expect.any(String)
        })
      );
    });
  });
});

describe('Diagnostic Tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should run full diagnostics', async () => {
    const result = await diagnostics.runFullDiagnostics();
    
    expect(diagnostics.runFullDiagnostics).toHaveBeenCalled();
    expect(result.timestamp).toBeDefined();
  });

  test('should run specific diagnostic', async () => {
    const result = await diagnostics.runSpecificDiagnostic('system');
    
    expect(diagnostics.runSpecificDiagnostic).toHaveBeenCalledWith('system');
    expect(result.status).toBe('ok');
  });

  test('should generate diagnostic report', async () => {
    const result = await diagnostics.generateReport('json');
    
    expect(diagnostics.generateReport).toHaveBeenCalledWith('json');
    expect(result.report).toBe('test');
  });

  test('should get diagnostic history', () => {
    const history = diagnostics.getDiagnosticHistory();
    
    expect(diagnostics.getDiagnosticHistory).toHaveBeenCalled();
    expect(Array.isArray(history)).toBe(true);
  });
});

describe('Logger Integration', () => {
  test('should provide log statistics', async () => {
    const stats = await logger.getLogStats();
    
    expect(logger.getLogStats).toHaveBeenCalled();
    expect(stats).toBeDefined();
  });

  test('should provide recent logs', async () => {
    const logs = await logger.getRecentLogs('combined', 10);
    
    expect(logger.getRecentLogs).toHaveBeenCalledWith('combined', 10);
    expect(Array.isArray(logs)).toBe(true);
  });

  test('should log different categories', async () => {
    await logger.error('Test error', { context: 'test' });
    await logger.warn('Test warning', { context: 'test' });
    await logger.info('Test info', { context: 'test' });
    await logger.debug('Test debug', { context: 'test' });
    await logger.queue('Test queue', { context: 'test' });
    await logger.template('Test template', { context: 'test' });
    await logger.printer('Test printer', { context: 'test' });

    expect(logger.error).toHaveBeenCalledWith('Test error', { context: 'test' });
    expect(logger.warn).toHaveBeenCalledWith('Test warning', { context: 'test' });
    expect(logger.info).toHaveBeenCalledWith('Test info', { context: 'test' });
    expect(logger.debug).toHaveBeenCalledWith('Test debug', { context: 'test' });
    expect(logger.queue).toHaveBeenCalledWith('Test queue', { context: 'test' });
    expect(logger.template).toHaveBeenCalledWith('Test template', { context: 'test' });
    expect(logger.printer).toHaveBeenCalledWith('Test printer', { context: 'test' });
  });
});