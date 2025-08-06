const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

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

const gracefulShutdown = (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);
  
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

// Server startup
const startServer = () => {
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
};

// Start the server
startServer();

module.exports = { app, server, io };