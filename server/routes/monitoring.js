const express = require('express');
const { asyncHandler } = require('../utils/errorHandler');
const logger = require('../utils/logger');
const diagnostics = require('../utils/diagnostics');
const router = express.Router();

/**
 * Error monitoring and reporting endpoints
 */

// GET /api/monitoring/health - Comprehensive health check
router.get('/health', asyncHandler(async (req, res) => {
  const detailed = req.query.detailed === 'true';
  
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.version,
    environment: process.env.NODE_ENV || 'development'
  };

  if (detailed) {
    // Run quick diagnostics for detailed health check
    const quickDiagnostics = await Promise.allSettled([
      diagnostics.runSpecificDiagnostic('database'),
      diagnostics.runSpecificDiagnostic('services'),
      diagnostics.runSpecificDiagnostic('performance')
    ]);

    healthCheck.diagnostics = {
      database: quickDiagnostics[0].status === 'fulfilled' ? quickDiagnostics[0].value : { error: quickDiagnostics[0].reason?.message },
      services: quickDiagnostics[1].status === 'fulfilled' ? quickDiagnostics[1].value : { error: quickDiagnostics[1].reason?.message },
      performance: quickDiagnostics[2].status === 'fulfilled' ? quickDiagnostics[2].value : { error: quickDiagnostics[2].reason?.message }
    };

    // Determine overall health status
    const hasErrors = quickDiagnostics.some(result => 
      result.status === 'rejected' || 
      (result.status === 'fulfilled' && result.value.errors?.length > 0)
    );

    if (hasErrors) {
      healthCheck.status = 'degraded';
    }
  }

  await logger.debug('Health check requested', { 
    detailed,
    status: healthCheck.status,
    ip: req.ip
  });

  // Set appropriate HTTP status based on health
  const statusCode = healthCheck.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(healthCheck);
}));

// GET /api/monitoring/errors - Recent error summary
router.get('/errors', asyncHandler(async (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const limit = parseInt(req.query.limit) || 50;
  
  const recentErrors = await logger.getRecentLogs('error', limit);
  
  // Filter errors from the last N hours
  const cutoffTime = new Date(Date.now() - (hours * 60 * 60 * 1000));
  const filteredErrors = recentErrors.filter(log => 
    new Date(log.timestamp) > cutoffTime
  );

  // Group errors by type/message for summary
  const errorSummary = {};
  filteredErrors.forEach(error => {
    const key = error.errorName || error.message || 'Unknown Error';
    if (!errorSummary[key]) {
      errorSummary[key] = {
        count: 0,
        firstOccurrence: error.timestamp,
        lastOccurrence: error.timestamp,
        examples: []
      };
    }
    
    errorSummary[key].count++;
    errorSummary[key].lastOccurrence = error.timestamp;
    
    if (errorSummary[key].examples.length < 3) {
      errorSummary[key].examples.push({
        timestamp: error.timestamp,
        message: error.message,
        context: error.context || {}
      });
    }
  });

  const response = {
    timeRange: {
      hours,
      from: cutoffTime.toISOString(),
      to: new Date().toISOString()
    },
    totalErrors: filteredErrors.length,
    uniqueErrorTypes: Object.keys(errorSummary).length,
    summary: errorSummary,
    recentErrors: filteredErrors.slice(0, 10) // Most recent 10 errors
  };

  await logger.info('Error monitoring data requested', { 
    hours,
    totalErrors: response.totalErrors,
    uniqueTypes: response.uniqueErrorTypes,
    ip: req.ip
  });

  res.json(response);
}));

// GET /api/monitoring/metrics - System metrics and performance data
router.get('/metrics', asyncHandler(async (req, res) => {
  const performanceDiagnostics = await diagnostics.runSpecificDiagnostic('performance');
  const systemDiagnostics = await diagnostics.runSpecificDiagnostic('system');
  
  const metrics = {
    timestamp: new Date().toISOString(),
    system: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      platform: process.platform,
      nodeVersion: process.version
    },
    performance: performanceDiagnostics,
    systemInfo: systemDiagnostics
  };

  // Add queue metrics if available
  const queueManager = req.app.get('queueManager');
  if (queueManager) {
    try {
      const queueStatus = await queueManager.getQueueStatus();
      metrics.queue = {
        totalJobs: queueStatus.totalJobs,
        queuedJobs: queueStatus.queuedJobs,
        processingJobs: queueStatus.processingJobs,
        completedJobs: queueStatus.completedJobs,
        failedJobs: queueStatus.failedJobs
      };
    } catch (error) {
      metrics.queue = { error: 'Failed to get queue metrics' };
    }
  }

  await logger.debug('System metrics requested', { ip: req.ip });

  res.json(metrics);
}));

// GET /api/monitoring/logs/:category - Get logs by category
router.get('/logs/:category', asyncHandler(async (req, res) => {
  const { category } = req.params;
  const lines = parseInt(req.query.lines) || 100;
  const level = req.query.level; // Optional filter by log level
  
  const validCategories = ['combined', 'error', 'access', 'printer', 'template', 'queue'];
  if (!validCategories.includes(category)) {
    return res.status(400).json({
      error: 'Invalid category',
      message: `Category must be one of: ${validCategories.join(', ')}`,
      validCategories
    });
  }

  const logs = await logger.getRecentLogs(category, lines);
  
  // Filter by level if specified
  let filteredLogs = logs;
  if (level) {
    filteredLogs = logs.filter(log => 
      log.level && log.level.toLowerCase() === level.toLowerCase()
    );
  }

  const response = {
    category,
    requestedLines: lines,
    actualLines: filteredLogs.length,
    level: level || 'all',
    logs: filteredLogs
  };

  await logger.debug('Log data requested', { 
    category,
    lines,
    level,
    returnedLines: filteredLogs.length,
    ip: req.ip
  });

  res.json(response);
}));

// POST /api/monitoring/test-error - Test error handling (development only)
router.post('/test-error', asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Error testing is not available in production'
    });
  }

  const { type, message } = req.body;
  
  await logger.warn('Test error triggered', { 
    type,
    message,
    ip: req.ip
  });

  // Simulate different types of errors
  switch (type) {
    case 'validation':
      throw new Error('Test validation error: ' + (message || 'Invalid input'));
    case 'database':
      throw new Error('Test database error: ' + (message || 'Connection failed'));
    case 'printer':
      throw new Error('Test printer error: ' + (message || 'Printer offline'));
    case 'template':
      throw new Error('Test template error: ' + (message || 'Template not found'));
    case 'timeout':
      // Simulate a timeout
      await new Promise(resolve => setTimeout(resolve, 5000));
      throw new Error('Test timeout error: ' + (message || 'Operation timed out'));
    default:
      throw new Error('Test generic error: ' + (message || 'Something went wrong'));
  }
}));

// GET /api/monitoring/diagnostics/history - Get diagnostic history
router.get('/diagnostics/history', asyncHandler(async (req, res) => {
  const history = diagnostics.getDiagnosticHistory();
  
  const response = {
    totalRuns: history.length,
    history: history.slice(-20) // Last 20 diagnostic runs
  };

  await logger.debug('Diagnostic history requested', { 
    totalRuns: response.totalRuns,
    ip: req.ip
  });

  res.json(response);
}));

// POST /api/monitoring/diagnostics/run - Run specific diagnostic
router.post('/diagnostics/run', asyncHandler(async (req, res) => {
  const { component } = req.body;
  
  if (!component) {
    return res.status(400).json({
      error: 'Missing component',
      message: 'Component parameter is required',
      validComponents: ['system', 'database', 'filesystem', 'printer', 'templates', 'services', 'logs', 'performance']
    });
  }

  await logger.info('Manual diagnostic run requested', { 
    component,
    ip: req.ip
  });

  const result = await diagnostics.runSpecificDiagnostic(component);
  
  res.json({
    component,
    timestamp: new Date().toISOString(),
    result
  });
}));

// GET /api/monitoring/alerts - Get system alerts based on thresholds
router.get('/alerts', asyncHandler(async (req, res) => {
  const alerts = [];
  
  // Check system metrics for alerts
  const performanceData = await diagnostics.runSpecificDiagnostic('performance');
  const systemData = await diagnostics.runSpecificDiagnostic('system');
  
  // Memory usage alert (>80%)
  const memoryUsage = performanceData.memoryUsage;
  if (memoryUsage && memoryUsage.heapUsed / memoryUsage.heapTotal > 0.8) {
    alerts.push({
      type: 'warning',
      category: 'memory',
      message: 'High memory usage detected',
      value: `${Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)}%`,
      threshold: '80%',
      timestamp: new Date().toISOString()
    });
  }

  // Event loop delay alert (>10ms)
  if (performanceData.eventLoopDelay && performanceData.eventLoopDelay > 10) {
    alerts.push({
      type: 'warning',
      category: 'performance',
      message: 'High event loop delay detected',
      value: `${performanceData.eventLoopDelay.toFixed(2)}ms`,
      threshold: '10ms',
      timestamp: new Date().toISOString()
    });
  }

  // Check recent errors
  const recentErrors = await logger.getRecentLogs('error', 10);
  const recentErrorCount = recentErrors.filter(log => 
    new Date(log.timestamp) > new Date(Date.now() - 60 * 60 * 1000) // Last hour
  ).length;

  if (recentErrorCount > 5) {
    alerts.push({
      type: 'error',
      category: 'errors',
      message: 'High error rate detected',
      value: `${recentErrorCount} errors in last hour`,
      threshold: '5 errors/hour',
      timestamp: new Date().toISOString()
    });
  }

  // Check queue status if available
  const queueManager = req.app.get('queueManager');
  if (queueManager) {
    try {
      const queueStatus = await queueManager.getQueueStatus();
      
      // Queue size alert
      if (queueStatus.queuedJobs > 20) {
        alerts.push({
          type: 'warning',
          category: 'queue',
          message: 'Large queue size detected',
          value: `${queueStatus.queuedJobs} jobs queued`,
          threshold: '20 jobs',
          timestamp: new Date().toISOString()
        });
      }

      // Failed jobs alert
      if (queueStatus.failedJobs > 3) {
        alerts.push({
          type: 'error',
          category: 'queue',
          message: 'Multiple failed jobs detected',
          value: `${queueStatus.failedJobs} failed jobs`,
          threshold: '3 failed jobs',
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      alerts.push({
        type: 'error',
        category: 'queue',
        message: 'Queue status check failed',
        value: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  const response = {
    timestamp: new Date().toISOString(),
    alertCount: alerts.length,
    alerts: alerts.sort((a, b) => {
      const typeOrder = { error: 0, warning: 1, info: 2 };
      return typeOrder[a.type] - typeOrder[b.type];
    })
  };

  await logger.debug('System alerts requested', { 
    alertCount: response.alertCount,
    ip: req.ip
  });

  res.json(response);
}));

module.exports = router;