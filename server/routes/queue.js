const express = require('express');
const router = express.Router();

// GET /api/queue - Retrieve current queue status
router.get('/', async (req, res, next) => {
  try {
    const queueManager = req.app.get('queueManager');
    
    if (!queueManager) {
      return res.status(503).json({ 
        error: 'Queue manager not available',
        message: 'The print queue service is not initialized'
      });
    }
    
    const queueStatus = await queueManager.getQueueStatus();
    const queueCapacity = await queueManager.getQueueCapacity();
    
    res.json({
      ...queueStatus,
      capacity: queueCapacity
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/queue/:id - Cancel specific job
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const queueManager = req.app.get('queueManager');
    
    if (!queueManager) {
      return res.status(503).json({ 
        error: 'Queue manager not available',
        message: 'The print queue service is not initialized'
      });
    }
    
    await queueManager.cancelJob(id);
    
    res.json({ 
      message: 'Job cancelled successfully',
      jobId: id
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/queue/:id/retry - Retry a failed job
router.post('/:id/retry', async (req, res, next) => {
  try {
    const { id } = req.params;
    const queueManager = req.app.get('queueManager');
    
    if (!queueManager) {
      return res.status(503).json({ 
        error: 'Queue manager not available',
        message: 'The print queue service is not initialized'
      });
    }
    
    const retriedJob = await queueManager.retryJob(id);
    
    res.json({ 
      message: 'Job retry scheduled successfully',
      job: retriedJob
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;