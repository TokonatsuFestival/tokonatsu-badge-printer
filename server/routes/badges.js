const express = require('express');
const router = express.Router();

// POST /api/badges - Submit new badge job
router.post('/', async (req, res, next) => {
  try {
    const { templateId, uid, badgeName } = req.body;
    const queueManager = req.app.get('queueManager');
    
    if (!queueManager) {
      return res.status(503).json({ 
        error: 'Queue manager not available',
        message: 'The print queue service is not initialized'
      });
    }
    
    // Validate required fields
    if (!templateId || !uid || !badgeName) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'templateId, uid, and badgeName are required',
        received: { templateId, uid, badgeName }
      });
    }
    
    // Add job to queue
    const job = await queueManager.addJob({ templateId, uid, badgeName });
    
    res.status(201).json({
      message: 'Badge job added to queue successfully',
      job
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;