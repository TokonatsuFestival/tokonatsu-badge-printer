const express = require('express');
const router = express.Router();

// DELETE /api/jobs/:id - Cancel specific job
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    if (!id || typeof id !== 'string' || id.trim() === '') {
      return res.status(400).json({
        error: 'Invalid job ID',
        message: 'Job ID must be a non-empty string'
      });
    }
    
    const queueManager = req.app.get('queueManager');
    
    if (!queueManager) {
      return res.status(503).json({ 
        error: 'Service unavailable',
        message: 'The print queue service is not initialized'
      });
    }
    
    await queueManager.cancelJob(id.trim());
    
    res.json({ 
      message: 'Job cancelled successfully',
      jobId: id.trim()
    });
  } catch (error) {
    // Handle specific error cases
    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Job not found',
        message: error.message,
        jobId: req.params.id
      });
    }
    
    if (error.message.includes('cannot be cancelled')) {
      return res.status(409).json({
        error: 'Job cannot be cancelled',
        message: error.message,
        jobId: req.params.id
      });
    }
    
    next(error);
  }
});

// POST /api/jobs/:id/retry - Retry a failed job
router.post('/:id/retry', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    if (!id || typeof id !== 'string' || id.trim() === '') {
      return res.status(400).json({
        error: 'Invalid job ID',
        message: 'Job ID must be a non-empty string'
      });
    }
    
    const queueManager = req.app.get('queueManager');
    
    if (!queueManager) {
      return res.status(503).json({ 
        error: 'Service unavailable',
        message: 'The print queue service is not initialized'
      });
    }
    
    const retriedJob = await queueManager.retryJob(id.trim());
    
    res.json({ 
      message: 'Job retry scheduled successfully',
      job: {
        id: retriedJob.id,
        templateId: retriedJob.templateId,
        uid: retriedJob.uid,
        badgeName: retriedJob.badgeName,
        status: retriedJob.status,
        retryCount: retriedJob.retryCount,
        createdAt: retriedJob.createdAt
      }
    });
  } catch (error) {
    // Handle specific error cases
    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Job not found',
        message: error.message,
        jobId: req.params.id
      });
    }
    
    if (error.message.includes('cannot be retried')) {
      return res.status(409).json({
        error: 'Job cannot be retried',
        message: error.message,
        jobId: req.params.id
      });
    }
    
    next(error);
  }
});

module.exports = router;