const express = require('express');
const TemplateProcessor = require('../services/TemplateProcessor');
const Template = require('../models/Template');
const router = express.Router();

// Input validation middleware
const validateBadgeInput = (req, res, next) => {
  let { templateId, uid, badgeName } = req.body;
  const errors = [];

  // Check required fields and trim whitespace first
  if (!templateId || typeof templateId !== 'string') {
    errors.push('templateId is required and must be a string');
  } else {
    templateId = templateId.trim();
    if (templateId === '') {
      errors.push('templateId cannot be empty');
    }
  }

  if (!uid || typeof uid !== 'string') {
    errors.push('uid is required and must be a string');
  } else {
    uid = uid.trim();
    if (uid === '') {
      errors.push('uid cannot be empty');
    }
  }

  if (!badgeName || typeof badgeName !== 'string') {
    errors.push('badgeName is required and must be a string');
  } else {
    badgeName = badgeName.trim();
    if (badgeName === '') {
      errors.push('badgeName cannot be empty');
    }
  }

  // Validate field lengths (after trimming)
  if (uid && uid.length > 50) {
    errors.push('uid must be 50 characters or less');
  }

  if (badgeName && badgeName.length > 100) {
    errors.push('badgeName must be 100 characters or less');
  }

  // Check for invalid characters in UID (alphanumeric, hyphens, underscores only) - after trimming
  if (uid && !/^[a-zA-Z0-9_-]+$/.test(uid)) {
    errors.push('uid can only contain letters, numbers, hyphens, and underscores');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: 'Validation failed',
      message: 'Invalid input data',
      details: errors,
      received: { templateId: req.body.templateId, uid: req.body.uid, badgeName: req.body.badgeName }
    });
  }

  // Set trimmed values
  req.body.templateId = templateId;
  req.body.uid = uid;
  req.body.badgeName = badgeName;

  next();
};

// POST /api/badges - Submit new badge job
router.post('/', validateBadgeInput, async (req, res, next) => {
  try {
    const { templateId, uid, badgeName } = req.body;
    const queueManager = req.app.get('queueManager');
    const dbConnection = req.app.get('dbConnection');
    
    if (!queueManager) {
      return res.status(503).json({ 
        error: 'Service unavailable',
        message: 'The print queue service is not initialized'
      });
    }
    
    if (!dbConnection) {
      return res.status(503).json({ 
        error: 'Service unavailable',
        message: 'Database connection is not available'
      });
    }
    
    // Validate template exists and is accessible
    const templateModel = new Template(dbConnection);
    const templateProcessor = new TemplateProcessor();
    
    try {
      const template = await templateModel.findById(templateId);
      if (!template) {
        return res.status(404).json({
          error: 'Template not found',
          message: `Template with ID '${templateId}' does not exist`,
          field: 'templateId'
        });
      }
      
      // Validate template file
      await templateModel.validateTemplateFile(templateId);
      
      // Validate template configuration
      const validationResult = await templateProcessor.validateTemplate(template.filePath);
      if (!validationResult.isValid) {
        return res.status(400).json({
          error: 'Template validation failed',
          message: validationResult.error,
          field: 'templateId'
        });
      }
      
    } catch (templateError) {
      return res.status(400).json({
        error: 'Template validation failed',
        message: templateError.message,
        field: 'templateId'
      });
    }
    
    // Add job to queue (this will handle UID uniqueness validation)
    const { badgeImage } = req.body;
    const job = await queueManager.addJob({ templateId, uid, badgeName, badgeImage });
    
    res.status(201).json({
      message: 'Badge job added to queue successfully',
      job: {
        id: job.id,
        templateId: job.templateId,
        uid: job.uid,
        badgeName: job.badgeName,
        status: job.status,
        createdAt: job.createdAt,
        retryCount: job.retryCount
      }
    });
  } catch (error) {
    // Handle specific validation errors
    if (error.message.includes('UID') && error.message.includes('already in use')) {
      return res.status(409).json({
        error: 'Duplicate UID',
        message: error.message,
        field: 'uid'
      });
    }
    
    if (error.message.includes('Template') && error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Template not found',
        message: error.message,
        field: 'templateId'
      });
    }
    
    next(error);
  }
});

// POST /api/badges/preview - Generate badge preview without creating job
router.post('/preview', validateBadgeInput, async (req, res, next) => {
  try {
    const { templateId, uid, badgeName } = req.body;
    const dbConnection = req.app.get('dbConnection');
    
    if (!dbConnection) {
      return res.status(503).json({ 
        error: 'Service unavailable',
        message: 'Database connection is not available'
      });
    }
    
    const templateModel = new Template(dbConnection);
    const templateProcessor = new TemplateProcessor();
    
    // Validate template exists and is accessible
    try {
      const template = await templateModel.findById(templateId);
      if (!template) {
        return res.status(404).json({
          error: 'Template not found',
          message: `Template with ID '${templateId}' does not exist`,
          field: 'templateId'
        });
      }
      
      // Validate template file
      await templateModel.validateTemplateFile(templateId);
      
    } catch (templateError) {
      return res.status(400).json({
        error: 'Template validation failed',
        message: templateError.message,
        field: 'templateId'
      });
    }
    
    // Generate badge preview
    const { badgeImage } = req.body;
    const badgeBuffer = await templateProcessor.generateBadge(templateId, uid, badgeName, templateModel, badgeImage);
    
    // Set appropriate headers for image response
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': badgeBuffer.length,
      'Cache-Control': 'no-cache', // Don't cache previews
      'ETag': `"${templateId}-${uid}-${badgeName}"`
    });
    
    res.send(badgeBuffer);
    
  } catch (error) {
    next(error);
  }
});

module.exports = router;