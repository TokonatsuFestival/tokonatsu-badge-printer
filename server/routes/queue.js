const express = require('express');
const { asyncHandler, createError } = require('../utils/errorHandler');
const logger = require('../utils/logger');
const router = express.Router();

// GET /api/queue - Retrieve current queue status
router.get('/', asyncHandler(async (req, res) => {
  const queueManager = req.app.get('queueManager');
  
  await logger.debug('Queue status requested', { ip: req.ip });
  
  if (!queueManager) {
    throw createError('SERVICE_UNAVAILABLE', 'The print queue service is not initialized');
  }
  
  try {
    const queueStatus = await queueManager.getQueueStatus();
    const queueCapacity = await queueManager.getQueueCapacity();
    
    await logger.queue('Queue status retrieved', { 
      totalJobs: queueStatus.totalJobs,
      queuedJobs: queueStatus.queuedJobs,
      processingJobs: queueStatus.processingJobs,
      completedJobs: queueStatus.completedJobs,
      failedJobs: queueStatus.failedJobs,
      capacity: queueCapacity
    });
    
    res.json({
      message: 'Queue status retrieved successfully',
      queue: {
        ...queueStatus,
        capacity: queueCapacity,
        timestamp: new Date().toISOString()
      }
    });
  } catch (queueError) {
    await logger.error('Failed to retrieve queue status', { 
      error: queueError
    });
    
    throw createError('INTERNAL_ERROR', 'Failed to retrieve queue status', {
      originalError: queueError.message
    });
  }
}));

module.exports = router;