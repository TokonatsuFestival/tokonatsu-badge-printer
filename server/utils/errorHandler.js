const logger = require('./logger');

/**
 * Error types and their user-friendly messages
 */
const ERROR_TYPES = {
  // Validation errors
  VALIDATION_ERROR: {
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    userMessage: 'The information you provided is not valid. Please check your input and try again.'
  },
  
  // Template errors
  TEMPLATE_NOT_FOUND: {
    code: 'TEMPLATE_NOT_FOUND',
    statusCode: 404,
    userMessage: 'The selected badge template could not be found. Please choose a different template.'
  },
  TEMPLATE_INVALID: {
    code: 'TEMPLATE_INVALID',
    statusCode: 400,
    userMessage: 'The selected template is corrupted or invalid. Please contact support.'
  },
  TEMPLATE_PROCESSING_ERROR: {
    code: 'TEMPLATE_PROCESSING_ERROR',
    statusCode: 500,
    userMessage: 'There was a problem processing the badge template. Please try again.'
  },
  
  // Printer errors
  PRINTER_NOT_FOUND: {
    code: 'PRINTER_NOT_FOUND',
    statusCode: 404,
    userMessage: 'No printer is connected. Please check the printer connection and try again.'
  },
  PRINTER_OFFLINE: {
    code: 'PRINTER_OFFLINE',
    statusCode: 503,
    userMessage: 'The printer is offline or not responding. Please check the printer status.'
  },
  PRINTER_ERROR: {
    code: 'PRINTER_ERROR',
    statusCode: 500,
    userMessage: 'There was a problem communicating with the printer. Please check the connection.'
  },
  PRINT_JOB_FAILED: {
    code: 'PRINT_JOB_FAILED',
    statusCode: 500,
    userMessage: 'The print job failed. Please check the printer and try again.'
  },
  
  // Queue errors
  QUEUE_FULL: {
    code: 'QUEUE_FULL',
    statusCode: 429,
    userMessage: 'The print queue is full. Please wait for some jobs to complete before adding more.'
  },
  JOB_NOT_FOUND: {
    code: 'JOB_NOT_FOUND',
    statusCode: 404,
    userMessage: 'The requested print job could not be found. It may have been completed or cancelled.'
  },
  JOB_CANNOT_BE_CANCELLED: {
    code: 'JOB_CANNOT_BE_CANCELLED',
    statusCode: 409,
    userMessage: 'This job cannot be cancelled because it has already been completed.'
  },
  DUPLICATE_UID: {
    code: 'DUPLICATE_UID',
    statusCode: 409,
    userMessage: 'This ID is already in use. Please use a different unique identifier.'
  },
  
  // Database errors
  DATABASE_ERROR: {
    code: 'DATABASE_ERROR',
    statusCode: 500,
    userMessage: 'There was a problem with the database. Please try again in a moment.'
  },
  DATABASE_CONNECTION_ERROR: {
    code: 'DATABASE_CONNECTION_ERROR',
    statusCode: 503,
    userMessage: 'Cannot connect to the database. Please contact support.'
  },
  
  // System errors
  SERVICE_UNAVAILABLE: {
    code: 'SERVICE_UNAVAILABLE',
    statusCode: 503,
    userMessage: 'The service is temporarily unavailable. Please try again in a moment.'
  },
  INTERNAL_ERROR: {
    code: 'INTERNAL_ERROR',
    statusCode: 500,
    userMessage: 'An unexpected error occurred. Please try again or contact support.'
  },
  TIMEOUT_ERROR: {
    code: 'TIMEOUT_ERROR',
    statusCode: 408,
    userMessage: 'The operation took too long to complete. Please try again.'
  },
  
  // File system errors
  FILE_NOT_FOUND: {
    code: 'FILE_NOT_FOUND',
    statusCode: 404,
    userMessage: 'The requested file could not be found.'
  },
  FILE_ACCESS_ERROR: {
    code: 'FILE_ACCESS_ERROR',
    statusCode: 403,
    userMessage: 'Cannot access the required file. Please check permissions.'
  },
  DISK_SPACE_ERROR: {
    code: 'DISK_SPACE_ERROR',
    statusCode: 507,
    userMessage: 'Not enough disk space to complete the operation.'
  }
};

/**
 * Custom error class for application-specific errors
 */
class AppError extends Error {
  constructor(type, message, originalError = null, context = {}) {
    const errorType = ERROR_TYPES[type] || ERROR_TYPES.INTERNAL_ERROR;
    
    super(message || errorType.userMessage);
    
    this.name = 'AppError';
    this.type = type;
    this.code = errorType.code;
    this.statusCode = errorType.statusCode;
    this.userMessage = errorType.userMessage;
    this.originalError = originalError;
    this.context = context;
    this.timestamp = new Date().toISOString();
    
    // Capture stack trace
    Error.captureStackTrace(this, AppError);
  }

  /**
   * Convert error to JSON for API responses
   */
  toJSON() {
    return {
      error: this.code,
      message: this.userMessage,
      timestamp: this.timestamp,
      ...(process.env.NODE_ENV === 'development' && {
        details: this.message,
        context: this.context,
        stack: this.stack
      })
    };
  }
}

/**
 * Error classification utility
 */
class ErrorClassifier {
  /**
   * Classify an error and return appropriate error type
   */
  static classify(error, context = {}) {
    if (error instanceof AppError) {
      return error;
    }

    const message = error.message || 'Unknown error';
    const lowerMessage = message.toLowerCase();

    // Database errors
    if (error.code === 'SQLITE_BUSY' || lowerMessage.includes('database is locked')) {
      return new AppError('DATABASE_ERROR', 'Database is busy', error, context);
    }
    if (error.code === 'SQLITE_CORRUPT' || lowerMessage.includes('database disk image is malformed')) {
      return new AppError('DATABASE_ERROR', 'Database is corrupted', error, context);
    }
    if (lowerMessage.includes('no such table') || lowerMessage.includes('no such column')) {
      return new AppError('DATABASE_ERROR', 'Database schema error', error, context);
    }

    // File system errors
    if (error.code === 'ENOENT') {
      return new AppError('FILE_NOT_FOUND', 'File not found', error, context);
    }
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      return new AppError('FILE_ACCESS_ERROR', 'File access denied', error, context);
    }
    if (error.code === 'ENOSPC') {
      return new AppError('DISK_SPACE_ERROR', 'Insufficient disk space', error, context);
    }

    // Network/timeout errors
    if (error.code === 'ETIMEDOUT' || lowerMessage.includes('timeout')) {
      return new AppError('TIMEOUT_ERROR', 'Operation timed out', error, context);
    }

    // Template errors
    if (lowerMessage.includes('template') && lowerMessage.includes('not found')) {
      return new AppError('TEMPLATE_NOT_FOUND', 'Template not found', error, context);
    }
    if (lowerMessage.includes('template') && (lowerMessage.includes('invalid') || lowerMessage.includes('corrupted'))) {
      return new AppError('TEMPLATE_INVALID', 'Template is invalid', error, context);
    }

    // Printer errors
    if (lowerMessage.includes('printer') && lowerMessage.includes('not found')) {
      return new AppError('PRINTER_NOT_FOUND', 'Printer not found', error, context);
    }
    if (lowerMessage.includes('printer') && (lowerMessage.includes('offline') || lowerMessage.includes('not responding'))) {
      return new AppError('PRINTER_OFFLINE', 'Printer is offline', error, context);
    }
    if (lowerMessage.includes('print') && lowerMessage.includes('failed')) {
      return new AppError('PRINT_JOB_FAILED', 'Print job failed', error, context);
    }

    // Queue errors
    if (lowerMessage.includes('queue') && lowerMessage.includes('full')) {
      return new AppError('QUEUE_FULL', 'Queue is full', error, context);
    }
    if (lowerMessage.includes('uid') && lowerMessage.includes('already')) {
      return new AppError('DUPLICATE_UID', 'Duplicate UID', error, context);
    }

    // Validation errors
    if (lowerMessage.includes('validation') || lowerMessage.includes('invalid input')) {
      return new AppError('VALIDATION_ERROR', 'Validation failed', error, context);
    }

    // Default to internal error
    return new AppError('INTERNAL_ERROR', 'Internal server error', error, context);
  }
}

/**
 * Error recovery mechanisms
 */
class ErrorRecovery {
  /**
   * Attempt to recover from common errors
   */
  static async attemptRecovery(error, context = {}) {
    const recovery = {
      attempted: false,
      successful: false,
      action: null,
      message: null
    };

    try {
      // Database recovery
      if (error.type === 'DATABASE_ERROR' && error.originalError?.code === 'SQLITE_BUSY') {
        recovery.attempted = true;
        recovery.action = 'database_retry';
        
        // Wait a short time and retry
        await new Promise(resolve => setTimeout(resolve, 100));
        recovery.successful = true;
        recovery.message = 'Database retry successful';
        
        return recovery;
      }

      // File system recovery
      if (error.type === 'FILE_NOT_FOUND' && context.templateId) {
        recovery.attempted = true;
        recovery.action = 'template_fallback';
        
        // Could attempt to use a default template or regenerate
        recovery.message = 'Template fallback attempted';
        
        return recovery;
      }

      // Printer recovery
      if (error.type === 'PRINTER_OFFLINE') {
        recovery.attempted = true;
        recovery.action = 'printer_reconnect';
        
        // Could attempt to reconnect to printer
        recovery.message = 'Printer reconnection attempted';
        
        return recovery;
      }

    } catch (recoveryError) {
      recovery.successful = false;
      recovery.message = `Recovery failed: ${recoveryError.message}`;
    }

    return recovery;
  }
}

/**
 * Express error handling middleware
 */
const errorMiddleware = async (error, req, res, next) => {
  // Classify the error
  const classifiedError = ErrorClassifier.classify(error, {
    url: req.url,
    method: req.method,
    body: req.body,
    params: req.params,
    query: req.query
  });

  // Log the error
  await logger.error('Request error occurred', {
    error: classifiedError,
    originalError: error,
    request: {
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    }
  });

  // Attempt recovery for certain error types
  const recovery = await ErrorRecovery.attemptRecovery(classifiedError, {
    templateId: req.body?.templateId,
    jobId: req.params?.id
  });

  if (recovery.attempted) {
    await logger.info('Error recovery attempted', {
      errorType: classifiedError.type,
      recovery
    });
  }

  // Send error response
  res.status(classifiedError.statusCode).json({
    ...classifiedError.toJSON(),
    ...(recovery.attempted && {
      recovery: {
        attempted: recovery.attempted,
        successful: recovery.successful,
        action: recovery.action
      }
    })
  });
};

/**
 * Async error wrapper for route handlers
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Create standardized error responses
 */
const createError = (type, message, context = {}) => {
  return new AppError(type, message, null, context);
};

module.exports = {
  AppError,
  ErrorClassifier,
  ErrorRecovery,
  errorMiddleware,
  asyncHandler,
  createError,
  ERROR_TYPES
};