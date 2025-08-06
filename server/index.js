const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

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

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url} - ${req.ip}`);
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

// Main route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ 
    error: 'API endpoint not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Global error handling middleware
app.use((err, req, res, next) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] Error:`, err.message);
  console.error(err.stack);
  
  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  res.status(err.status || 500).json({
    error: isDevelopment ? err.message : 'Internal server error',
    timestamp,
    ...(isDevelopment && { stack: err.stack })
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Client connected: ${socket.id}`);
  
  // Send initial connection confirmation
  socket.emit('connected', { 
    message: 'Connected to Festival Badge Printer',
    timestamp 
  });
  
  // Handle client disconnection
  socket.on('disconnect', (reason) => {
    const disconnectTime = new Date().toISOString();
    console.log(`[${disconnectTime}] Client disconnected: ${socket.id} - Reason: ${reason}`);
  });
  
  // Handle connection errors
  socket.on('error', (error) => {
    const errorTime = new Date().toISOString();
    console.error(`[${errorTime}] Socket error for ${socket.id}:`, error);
  });
});

// Graceful shutdown handling
let isShuttingDown = false;

const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);
  
  try {
    // Stop queue manager
    if (queueManager) {
      console.log('Stopping queue manager...');
      await queueManager.cleanup();
      console.log('Queue manager stopped.');
    }
    
    // Close database connection
    if (dbConnection) {
      console.log('Closing database connection...');
      await dbConnection.close();
      console.log('Database connection closed.');
    }
    
    // Close server to stop accepting new connections
    server.close((err) => {
      if (err) {
        console.error('Error during server shutdown:', err);
        process.exit(1);
      }
      
      console.log('HTTP server closed.');
      
      // Close Socket.io connections
      io.close(() => {
        console.log('Socket.io server closed.');
        
        // Exit process
        console.log('Graceful shutdown completed.');
        process.exit(0);
      });
    });
  } catch (error) {
    console.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// Initialize services
const initializeServices = async () => {
  try {
    // Initialize database connection
    dbConnection = new DatabaseConnection();
    await dbConnection.connect();
    
    // Initialize database schema by calling createTables directly
    await createDatabaseTables(dbConnection);
    
    // Initialize models
    const badgeJobModel = new BadgeJob(dbConnection);
    
    // Initialize services
    const printerInterface = new PrinterInterface();
    const templateProcessor = new TemplateProcessor();
    
    // Initialize queue manager
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
    
    // Set up queue manager event listeners
    queueManager.on('error', (error) => {
      console.error('Queue Manager Error:', error);
    });
    
    queueManager.on('jobAdded', (job) => {
      console.log(`Job added to queue: ${job.id}`);
    });
    
    queueManager.on('jobCompleted', (job) => {
      console.log(`Job completed: ${job.id}`);
    });
    
    queueManager.on('jobFailed', (job, error) => {
      console.error(`Job failed: ${job.id} - ${error.message}`);
    });
    
    queueManager.on('jobCancelled', (job) => {
      console.log(`Job cancelled: ${job.id}`);
    });
    
    // Make services available to routes
    app.set('queueManager', queueManager);
    app.set('dbConnection', dbConnection);
    
    console.log('Services initialized successfully');
    
  } catch (error) {
    console.error('Failed to initialize services:', error);
    process.exit(1);
  }
};

// Server startup
const startServer = async () => {
  try {
    // Initialize services first
    await initializeServices();
    
    server.listen(PORT, () => {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] Festival Badge Printer server running on port ${PORT}`);
      console.log(`[${timestamp}] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[${timestamp}] Process ID: ${process.pid}`);
    });
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use`);
        process.exit(1);
      } else {
        console.error('Server error:', err);
        process.exit(1);
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();

module.exports = { app, server, io };