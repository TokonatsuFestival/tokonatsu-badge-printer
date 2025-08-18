const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

// Import utilities
const logger = require('./utils/logger');
const { errorMiddleware, asyncHandler } = require('./utils/errorHandler');
const diagnostics = require('./utils/diagnostics');

// Import services and models
const DatabaseConnection = require('./database/connection');
const BadgeJob = require('./models/BadgeJob');
const PrinterInterface = require('./services/PrinterInterface');
const TemplateProcessor = require('./services/TemplateProcessor');
const PrintQueueManager = require('./services/PrintQueueManager');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Initialize services
let dbConnection;
let queueManager;

// Database table creation function
async function createDatabaseTables(connection) {
  // Create badge_jobs table
  const createBadgeJobsTable = `
    CREATE TABLE IF NOT EXISTS badge_jobs (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      uid TEXT NOT NULL,
      badge_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at DATETIME,
      retry_count INTEGER DEFAULT 0,
      error_message TEXT,
      FOREIGN KEY (template_id) REFERENCES templates (id)
    )
  `;

  // Create templates table
  const createTemplatesTable = `
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      preview_path TEXT,
      text_fields TEXT NOT NULL,
      printer_presets TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  // Create printer_configurations table
  const createPrinterConfigsTable = `
    CREATE TABLE IF NOT EXISTS printer_configurations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_connected BOOLEAN DEFAULT FALSE,
      presets TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  // Create indexes for better performance
  const createIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_badge_jobs_status ON badge_jobs(status)',
    'CREATE INDEX IF NOT EXISTS idx_badge_jobs_created_at ON badge_jobs(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_badge_jobs_uid ON badge_jobs(uid)',
    'CREATE INDEX IF NOT EXISTS idx_templates_name ON templates(name)',
    'CREATE INDEX IF NOT EXISTS idx_printer_configs_name ON printer_configurations(name)'
  ];

  // Execute table creation
  await connection.run(createBadgeJobsTable);
  await connection.run(createTemplatesTable);
  await connection.run(createPrinterConfigsTable);

  // Execute index creation
  for (const indexSql of createIndexes) {
    await connection.run(indexSql);
  }
  
  console.log('Database tables created successfully');
}

// Request logging middleware with timing
app.use((req, res, next) => {
  const startTime = Date.now();
  
  // Override res.end to capture response time
  const originalEnd = res.end;
  res.end = function(...args) {
    const responseTime = Date.now() - startTime;
    logger.access(req, res, responseTime);
    originalEnd.apply(this, args);
  };
  
  next();
});

// JSON parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static file serving middleware
app.use(express.static(path.join(__dirname, '../public')));
app.use('/templates', express.static(path.join(__dirname, '../templates')));

// API Routes structure
app.use('/api/badges', require('./routes/badges'));
app.use('/api/queue', require('./routes/queue'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/printers', require('./routes/printers'));
app.use('/api/badge-images', require('./routes/badge-images'));
app.use('/api/monitoring', require('./routes/monitoring'));

// Main route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Health check endpoint
app.get('/health', asyncHandler(async (req, res) => {
  const healthStatus = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: dbConnection ? 'connected' : 'disconnected',
      queueManager: queueManager ? 'initialized' : 'not-initialized'
    }
  };
  
  await logger.info('Health check requested', { 
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  res.json(healthStatus);
}));

// Diagnostics endpoint
app.get('/api/diagnostics', asyncHandler(async (req, res) => {
  const component = req.query.component;
  
  await logger.info('Diagnostics requested', { 
    component: component || 'full',
    ip: req.ip 
  });
  
  let result;
  if (component) {
    result = await diagnostics.runSpecificDiagnostic(component);
  } else {
    result = await diagnostics.runFullDiagnostics();
  }
  
  res.json(result);
}));

// Diagnostics report endpoint
app.get('/api/diagnostics/report', asyncHandler(async (req, res) => {
  const format = req.query.format || 'json';
  
  await logger.info('Diagnostics report requested', { 
    format,
    ip: req.ip 
  });
  
  const report = await diagnostics.generateReport(format);
  
  if (format === 'text') {
    res.set('Content-Type', 'text/plain');
    res.send(report);
  } else {
    res.json(report);
  }
}));

// Log statistics endpoint
app.get('/api/logs/stats', asyncHandler(async (req, res) => {
  const stats = await logger.getLogStats();
  res.json(stats);
}));

// Recent logs endpoint
app.get('/api/logs/recent', asyncHandler(async (req, res) => {
  const category = req.query.category || 'combined';
  const lines = parseInt(req.query.lines) || 100;
  
  const logs = await logger.getRecentLogs(category, lines);
  res.json({ category, lines: logs.length, logs });
}));

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ 
    error: 'API endpoint not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Use comprehensive error handling middleware
app.use(errorMiddleware);

// Socket.io connection handling with comprehensive logging
io.on('connection', (socket) => {
  logger.info('Client connected', { 
    socketId: socket.id,
    clientIP: socket.handshake.address
  });
  
  // Send initial connection confirmation
  socket.emit('connected', { 
    message: 'Connected to Festival Badge Printer',
    timestamp: new Date().toISOString()
  });
  
  // Handle client disconnection
  socket.on('disconnect', (reason) => {
    logger.info('Client disconnected', { 
      socketId: socket.id,
      reason,
      clientIP: socket.handshake.address
    });
  });
  
  // Handle connection errors
  socket.on('error', (error) => {
    logger.error('Socket error occurred', { 
      error,
      socketId: socket.id,
      clientIP: socket.handshake.address
    });
  });
  
  // Handle queue status requests
  socket.on('requestQueueStatus', async () => {
    try {
      if (queueManager) {
        const status = await queueManager.getQueueStatus();
        socket.emit('queueStatus', status);
      }
    } catch (error) {
      logger.error('Failed to send queue status', { error, socketId: socket.id });
      socket.emit('error', { message: 'Failed to get queue status' });
    }
  });
});

// Graceful shutdown handling
let isShuttingDown = false;

const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  await logger.info('Graceful shutdown initiated', { signal });
  
  try {
    // Stop queue manager
    if (queueManager) {
      await logger.info('Stopping queue manager');
      await queueManager.cleanup();
      await logger.info('Queue manager stopped');
    }
    
    // Close database connection
    if (dbConnection) {
      await logger.info('Closing database connection');
      await dbConnection.close();
      await logger.info('Database connection closed');
    }
    
    // Close server to stop accepting new connections
    server.close(async (err) => {
      if (err) {
        await logger.error('Error during server shutdown', { error: err });
        process.exit(1);
      }
      
      await logger.info('HTTP server closed');
      
      // Close Socket.io connections
      io.close(async () => {
        await logger.info('Socket.io server closed');
        await logger.info('Graceful shutdown completed');
        process.exit(0);
      });
    });
  } catch (error) {
    await logger.error('Error during graceful shutdown', { error });
    process.exit(1);
  }
  
  // Force shutdown after 10 seconds
  setTimeout(async () => {
    await logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', async (err) => {
  await logger.error('Uncaught Exception occurred', { error: err });
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason, promise) => {
  await logger.error('Unhandled Promise Rejection', { 
    reason: reason instanceof Error ? reason : String(reason),
    promise: promise.toString()
  });
  gracefulShutdown('unhandledRejection');
});

// Initialize services
const initializeServices = async () => {
  try {
    await logger.info('Starting service initialization');
    
    // Initialize database connection
    await logger.info('Initializing database connection');
    dbConnection = new DatabaseConnection();
    await dbConnection.connect();
    await logger.info('Database connection established');
    
    // Initialize database schema by calling createTables directly
    await logger.info('Creating database tables');
    await createDatabaseTables(dbConnection);
    await logger.info('Database tables created successfully');
    
    // Initialize models
    const badgeJobModel = new BadgeJob(dbConnection);
    await logger.info('Badge job model initialized');
    
    // Initialize services
    await logger.info('Initializing printer interface');
    const printerInterface = new PrinterInterface();
    
    await logger.info('Initializing template processor');
    const templateProcessor = new TemplateProcessor();
    
    // Initialize queue manager
    await logger.info('Initializing queue manager');
    queueManager = new PrintQueueManager(
      badgeJobModel,
      printerInterface,
      templateProcessor,
      io,
      {
        maxQueueSize: 50,
        maxRetries: 3,
        retryBaseDelay: 1000,
        processingTimeout: 30000
      }
    );
    
    // Set up queue manager event listeners with comprehensive logging
    queueManager.on('error', async (error) => {
      await logger.error('Queue Manager Error', { error });
    });
    
    queueManager.on('jobAdded', async (job) => {
      await logger.queue('Job added to queue', { 
        jobId: job.id,
        templateId: job.templateId,
        uid: job.uid
      });
    });
    
    queueManager.on('jobCompleted', async (job) => {
      await logger.queue('Job completed successfully', { 
        jobId: job.id,
        templateId: job.templateId,
        uid: job.uid,
        processingTime: job.processedAt ? new Date(job.processedAt) - new Date(job.createdAt) : null
      });
    });
    
    queueManager.on('jobFailed', async (job, error) => {
      await logger.error('Job failed', { 
        error,
        jobId: job.id,
        templateId: job.templateId,
        uid: job.uid,
        retryCount: job.retryCount
      });
    });
    
    queueManager.on('jobCancelled', async (job) => {
      await logger.queue('Job cancelled', { 
        jobId: job.id,
        templateId: job.templateId,
        uid: job.uid
      });
    });
    
    queueManager.on('jobRetry', async (job, attempt) => {
      await logger.warn('Job retry attempted', { 
        jobId: job.id,
        templateId: job.templateId,
        uid: job.uid,
        attempt,
        maxRetries: queueManager.options.maxRetries
      });
    });
    
    // Make services available to routes
    app.set('queueManager', queueManager);
    app.set('dbConnection', dbConnection);
    app.set('printerInterface', printerInterface);
    
    await logger.info('All services initialized successfully');
    
  } catch (error) {
    await logger.error('Failed to initialize services', { error });
    process.exit(1);
  }
};

// Server startup
const startServer = async () => {
  try {
    // Initialize services first
    await initializeServices();
    
    server.listen(PORT, async () => {
      await logger.info('Festival Badge Printer server started', {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        processId: process.pid,
        nodeVersion: process.version,
        platform: process.platform
      });
    });
    
    server.on('error', async (err) => {
      if (err.code === 'EADDRINUSE') {
        await logger.error('Port already in use', { port: PORT, error: err });
        process.exit(1);
      } else {
        await logger.error('Server error occurred', { error: err });
        process.exit(1);
      }
    });
  } catch (error) {
    await logger.error('Failed to start server', { error });
    process.exit(1);
  }
};

// Start the server
startServer();

module.exports = { app, server, io };