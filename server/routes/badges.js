const express = require('express');
const TemplateProcessor = require('../services/TemplateProcessor');
const Template = require('../models/Template');
const { asyncHandler, createError } = require('../utils/errorHandler');
const logger = require('../utils/logger');
const router = express.Router();

// Input validation middleware
const validateBadgeInput = asyncHandler(async (req, res, next) => {
  let { templateId, uid, badgeName } = req.body;
  const errors = [];

  await logger.debug('Badge input validation started', { 
    originalInput: { templateId, uid, badgeName },
    ip: req.ip
  });

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
    await logger.warn('Badge input validation failed', { 
      errors,
      received: { templateId: req.body.templateId, uid: req.body.uid, badgeName: req.body.badgeName },
      ip: req.ip
    });
    
    throw createError('VALIDATION_ERROR', 'Invalid input data', { 
      details: errors,
      received: { templateId: req.body.templateId, uid: req.body.uid, badgeName: req.body.badgeName }
    });
  }

  // Set trimmed values
  req.body.templateId = templateId;
  req.body.uid = uid;
  req.body.badgeName = badgeName;

  await logger.debug('Badge input validation passed', { 
    validatedInput: { templateId, uid, badgeName }
  });

  next();
});

// POST /api/badges - Submit new badge job
router.post('/', validateBadgeInput, asyncHandler(async (req, res) => {
  const { templateId, uid, badgeName } = req.body;
  const queueManager = req.app.get('queueManager');
  const dbConnection = req.app.get('dbConnection');
  
  await logger.info('Badge job submission started', { 
    templateId, 
    uid, 
    badgeName,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  if (!queueManager) {
    throw createError('SERVICE_UNAVAILABLE', 'The print queue service is not initialized');
  }
  
  if (!dbConnection) {
    throw createError('SERVICE_UNAVAILABLE', 'Database connection is not available');
  }
  
  // Validate template exists and is accessible
  const templateModel = new Template(dbConnection);
  const templateProcessor = new TemplateProcessor();
  
  try {
    const template = await templateModel.findById(templateId);
    if (!template) {
      throw createError('TEMPLATE_NOT_FOUND', `Template with ID '${templateId}' does not exist`, {
        templateId,
        field: 'templateId'
      });
    }
    
    await logger.template('Template found for badge job', { 
      templateId,
      templateName: template.name,
      templatePath: template.filePath
    });
    
    // Validate template file
    await templateModel.validateTemplateFile(templateId);
    
    // Validate template configuration
    const validationResult = await templateProcessor.validateTemplate(template.filePath);
    if (!validationResult.isValid) {
      throw createError('TEMPLATE_INVALID', validationResult.error, {
        templateId,
        field: 'templateId'
      });
    }
    
    await logger.template('Template validation passed', { 
      templateId,
      validationResult
    });
    
  } catch (templateError) {
    if (templateError.type) {
      // Already a classified error
      throw templateError;
    }
    
    await logger.error('Template validation error', { 
      error: templateError,
      templateId
    });
    
    throw createError('TEMPLATE_PROCESSING_ERROR', templateError.message, {
      templateId,
      field: 'templateId'
    });
  }
  
  // Add job to queue (this will handle UID uniqueness validation)
  try {
    const { badgeImage } = req.body;
    const job = await queueManager.addJob({ templateId, uid, badgeName, badgeImage });
    
    await logger.info('Badge job added to queue successfully', { 
      jobId: job.id,
      templateId: job.templateId,
      uid: job.uid,
      badgeName: job.badgeName
    });
    
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
  } catch (queueError) {
    // Handle specific queue errors
    if (queueError.message.includes('UID') && queueError.message.includes('already in use')) {
      throw createError('DUPLICATE_UID', queueError.message, {
        uid,
        field: 'uid'
      });
    }
    
    if (queueError.message.includes('queue') && queueError.message.includes('full')) {
      throw createError('QUEUE_FULL', queueError.message);
    }
    
    await logger.error('Queue error occurred', { 
      error: queueError,
      templateId,
      uid,
      badgeName
    });
    
    throw createError('INTERNAL_ERROR', 'Failed to add job to queue', {
      originalError: queueError.message
    });
  }
}));

// POST /api/badges/preview - Generate badge preview without creating job
router.post('/preview', validateBadgeInput, asyncHandler(async (req, res) => {
  const { templateId, uid, badgeName } = req.body;
  const dbConnection = req.app.get('dbConnection');
  
  await logger.info('Badge preview generation started', { 
    templateId, 
    uid, 
    badgeName,
    ip: req.ip
  });
  
  if (!dbConnection) {
    throw createError('SERVICE_UNAVAILABLE', 'Database connection is not available');
  }
  
  const templateModel = new Template(dbConnection);
  const templateProcessor = new TemplateProcessor();
  
  // Validate template exists and is accessible
  try {
    const template = await templateModel.findById(templateId);
    if (!template) {
      throw createError('TEMPLATE_NOT_FOUND', `Template with ID '${templateId}' does not exist`, {
        templateId,
        field: 'templateId'
      });
    }
    
    // Validate template file
    await templateModel.validateTemplateFile(templateId);
    
    await logger.template('Template validated for preview', { 
      templateId,
      templateName: template.name
    });
    
  } catch (templateError) {
    if (templateError.type) {
      throw templateError;
    }
    
    await logger.error('Template validation failed for preview', { 
      error: templateError,
      templateId
    });
    
    throw createError('TEMPLATE_PROCESSING_ERROR', templateError.message, {
      templateId,
      field: 'templateId'
    });
  }
  
  // Generate badge preview
  try {
    const { badgeImage } = req.body;
    const badgeBuffer = await templateProcessor.generateBadge(templateId, uid, badgeName, templateModel, badgeImage);
    
    await logger.template('Badge preview generated successfully', { 
      templateId,
      uid,
      badgeName,
      bufferSize: badgeBuffer.length
    });
    
    // Set appropriate headers for image response
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': badgeBuffer.length,
      'Cache-Control': 'no-cache', // Don't cache previews
      'ETag': `"${templateId}-${uid}-${badgeName}"`
    });
    
    res.send(badgeBuffer);
    
  } catch (generationError) {
    await logger.error('Badge preview generation failed', { 
      error: generationError,
      templateId,
      uid,
      badgeName
    });
    
    throw createError('TEMPLATE_PROCESSING_ERROR', 'Failed to generate badge preview', {
      originalError: generationError.message
    });
  }
}));

module.exports = router;