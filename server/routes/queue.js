const express = require('express');
const router = express.Router();

// GET /api/queue - Retrieve current queue status
router.get('/', async (req, res, next) => {
  try {
    const queueManager = req.app.get('queueManager');
    
    if (!queueManager) {
      return res.status(503).json({ 
        error: 'Service unavailable',
        message: 'The print queue service is not initialized'
      });
    }
    
    const queueStatus = await queueManager.getQueueStatus();
    const queueCapacity = await queueManager.getQueueCapacity();
    
    res.json({
      message: 'Queue status retrieved successfully',
      queue: {
        ...queueStatus,
        capacity: queueCapacity,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;