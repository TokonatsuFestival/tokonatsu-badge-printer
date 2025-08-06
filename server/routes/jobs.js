const express = require('express');
const router = express.Router();

// GET /api/jobs/history - Get job history with filtering
router.get('/history', async (req, res, next) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    
    const dbConnection = req.app.get('dbConnection');
    
    if (!dbConnection) {
      return res.status(503).json({ 
        error: 'Service unavailable',
        message: 'Database connection is not available'
      });
    }
    
    // Build query based on filters
    let sql = 'SELECT * FROM badge_jobs';
    let params = [];
    let whereConditions = [];
    
    if (status && ['completed', 'failed'].includes(status)) {
      whereConditions.push('status = ?');
      params.push(status);
    } else {
      // Default to completed and failed jobs for history
      whereConditions.push('status IN (?, ?)');
      params.push('completed', 'failed');
    }
    
    if (whereConditions.length > 0) {
      sql += ' WHERE ' + whereConditions.join(' AND ');
    }
    
    sql += ' ORDER BY processed_at DESC, created_at DESC';
    
    // Add pagination
    sql += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const rows = await dbConnection.all(sql, params);
    
    // Get total count for pagination
    let countSql = 'SELECT COUNT(*) as total FROM badge_jobs';
    let countParams = [];
    
    if (status && ['completed', 'failed'].includes(status)) {
      countSql += ' WHERE status = ?';
      countParams.push(status);
    } else {
      countSql += ' WHERE status IN (?, ?)';
      countParams.push('completed', 'failed');
    }
    
    const countResult = await dbConnection.get(countSql, countParams);
    const total = countResult.total;
    
    // Map rows to job objects
    const jobs = rows.map(row => ({
      id: row.id,
      templateId: row.template_id,
      uid: row.uid,
      badgeName: row.badge_name,
      status: row.status,
      createdAt: new Date(row.created_at),
      processedAt: row.processed_at ? new Date(row.processed_at) : null,
      retryCount: row.retry_count,
      errorMessage: row.error_message
    }));
    
    res.json({
      message: 'Job history retrieved successfully',
      jobs,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: (parseInt(offset) + parseInt(limit)) < total
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/jobs/:id/manual-intervention - Manual intervention for stuck jobs
router.post('/:id/manual-intervention', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action, reason } = req.body;
    
    if (!id || typeof id !== 'string' || id.trim() === '') {
      return res.status(400).json({
        error: 'Invalid job ID',
        message: 'Job ID must be a non-empty string'
      });
    }
    
    if (!action || !['reset', 'fail', 'complete'].includes(action)) {
      return res.status(400).json({
        error: 'Invalid action',
        message: 'Action must be one of: reset, fail, complete'
      });
    }
    
    const queueManager = req.app.get('queueManager');
    const dbConnection = req.app.get('dbConnection');
    
    if (!queueManager || !dbConnection) {
      return res.status(503).json({ 
        error: 'Service unavailable',
        message: 'Required services are not available'
      });
    }
    
    // Get the job first
    const BadgeJob = require('../models/BadgeJob');
    const badgeJobModel = new BadgeJob(dbConnection);
    const job = await badgeJobModel.findById(id.trim());
    
    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
        message: `Job with ID ${id} not found`,
        jobId: id.trim()
      });
    }
    
    // Only allow manual intervention on processing or failed jobs
    if (!['processing', 'failed'].includes(job.status)) {
      return res.status(409).json({
        error: 'Manual intervention not allowed',
        message: `Manual intervention is only allowed for processing or failed jobs. Current status: ${job.status}`,
        jobId: id.trim()
      });
    }
    
    let updatedJob;
    const interventionReason = reason || `Manual intervention: ${action}`;
    
    switch (action) {
      case 'reset':
        // Reset job to queued status
        updatedJob = await badgeJobModel.updateStatus(id.trim(), 'queued');
        break;
      case 'fail':
        // Mark job as failed with intervention reason
        updatedJob = await badgeJobModel.updateStatus(id.trim(), 'failed', interventionReason);
        break;
      case 'complete':
        // Mark job as completed (manual completion)
        updatedJob = await badgeJobModel.updateStatus(id.trim(), 'completed');
        break;
    }
    
    // Broadcast the change
    queueManager.broadcastQueueUpdate();
    queueManager.broadcastJobStatusChange(updatedJob);
    
    res.json({
      message: `Manual intervention completed: ${action}`,
      job: {
        id: updatedJob.id,
        templateId: updatedJob.templateId,
        uid: updatedJob.uid,
        badgeName: updatedJob.badgeName,
        status: updatedJob.status,
        retryCount: updatedJob.retryCount,
        errorMessage: updatedJob.errorMessage,
        createdAt: updatedJob.createdAt,
        processedAt: updatedJob.processedAt
      },
      intervention: {
        action,
        reason: interventionReason,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

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
    
    if (error.message.includes('Cannot cancel')) {
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
    
    if (error.message.includes('Only failed jobs can be retried') || 
        error.message.includes('exceeded maximum retry attempts')) {
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