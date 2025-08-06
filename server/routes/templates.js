const express = require('express');
const Template = require('../models/Template');
const TemplateProcessor = require('../services/TemplateProcessor');
const router = express.Router();

// GET /api/templates - Get available badge templates
router.get('/', async (req, res, next) => {
  try {
    const dbConnection = req.app.get('dbConnection');
    
    if (!dbConnection) {
      return res.status(503).json({ 
        error: 'Service unavailable',
        message: 'Database connection is not available'
      });
    }
    
    const templateModel = new Template(dbConnection);
    const templates = await templateModel.findAll();
    
    // Return templates with essential information for the frontend
    const templateList = templates.map(template => ({
      id: template.id,
      name: template.name,
      previewPath: template.previewPath,
      textFields: template.textFields,
      printerPresets: template.printerPresets,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt
    }));
    
    res.json({
      message: 'Templates retrieved successfully',
      templates: templateList,
      count: templateList.length
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/templates/:id - Get specific template details
router.get('/:id', async (req, res, next) => {
  try {
    let { id } = req.params;
    
    // Decode URL-encoded characters and trim
    id = decodeURIComponent(id).trim();
    
    if (!id || typeof id !== 'string' || id === '') {
      return res.status(400).json({
        error: 'Invalid template ID',
        message: 'Template ID must be a non-empty string'
      });
    }
    
    const dbConnection = req.app.get('dbConnection');
    
    if (!dbConnection) {
      return res.status(503).json({ 
        error: 'Service unavailable',
        message: 'Database connection is not available'
      });
    }
    
    const templateModel = new Template(dbConnection);
    const template = await templateModel.findById(id);
    
    if (!template) {
      return res.status(404).json({
        error: 'Template not found',
        message: `Template with ID '${id}' does not exist`
      });
    }
    
    // Validate that the template file still exists
    try {
      await templateModel.validateTemplateFile(id);
    } catch (fileError) {
      return res.status(500).json({
        error: 'Template file error',
        message: fileError.message,
        template: {
          id: template.id,
          name: template.name,
          status: 'file_missing'
        }
      });
    }
    
    res.json({
      message: 'Template retrieved successfully',
      template: {
        id: template.id,
        name: template.name,
        filePath: template.filePath,
        previewPath: template.previewPath,
        textFields: template.textFields,
        printerPresets: template.printerPresets,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/templates/:id/preview - Generate template preview
router.get('/:id/preview', async (req, res, next) => {
  try {
    let { id } = req.params;
    
    // Decode URL-encoded characters and trim
    id = decodeURIComponent(id).trim();
    
    if (!id || typeof id !== 'string' || id === '') {
      return res.status(400).json({
        error: 'Invalid template ID',
        message: 'Template ID must be a non-empty string'
      });
    }
    
    const dbConnection = req.app.get('dbConnection');
    
    if (!dbConnection) {
      return res.status(503).json({ 
        error: 'Service unavailable',
        message: 'Database connection is not available'
      });
    }
    
    const templateModel = new Template(dbConnection);
    const templateProcessor = new TemplateProcessor();
    
    // Check if template exists
    const template = await templateModel.findById(id);
    if (!template) {
      return res.status(404).json({
        error: 'Template not found',
        message: `Template with ID '${id}' does not exist`
      });
    }
    
    // Validate template file
    try {
      await templateModel.validateTemplateFile(id);
    } catch (fileError) {
      return res.status(500).json({
        error: 'Template file error',
        message: fileError.message
      });
    }
    
    // Generate preview
    const badgeImage = req.query.badgeImage;
    const previewBuffer = await templateProcessor.getTemplatePreview(id, templateModel, badgeImage);
    
    // Set appropriate headers for image response
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': previewBuffer.length,
      'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      'ETag': `"${id}-preview"`
    });
    
    res.send(previewBuffer);
    
  } catch (error) {
    next(error);
  }
});

// POST /api/templates/:id/validate - Validate template file
router.post('/:id/validate', async (req, res, next) => {
  try {
    let { id } = req.params;
    
    // Decode URL-encoded characters and trim
    id = decodeURIComponent(id).trim();
    
    if (!id || typeof id !== 'string' || id === '') {
      return res.status(400).json({
        error: 'Invalid template ID',
        message: 'Template ID must be a non-empty string'
      });
    }
    
    const dbConnection = req.app.get('dbConnection');
    
    if (!dbConnection) {
      return res.status(503).json({ 
        error: 'Service unavailable',
        message: 'Database connection is not available'
      });
    }
    
    const templateModel = new Template(dbConnection);
    const templateProcessor = new TemplateProcessor();
    
    // Check if template exists
    const template = await templateModel.findById(id);
    if (!template) {
      return res.status(404).json({
        error: 'Template not found',
        message: `Template with ID '${id}' does not exist`
      });
    }
    
    // Validate template file
    const validationResult = await templateProcessor.validateTemplate(template.filePath);
    
    res.json({
      message: 'Template validation completed',
      template: {
        id: template.id,
        name: template.name,
        filePath: template.filePath
      },
      validation: validationResult
    });
    
  } catch (error) {
    next(error);
  }
});

// PUT /api/templates/:id/text-fields - Update template text field positions
router.put('/:id/text-fields', async (req, res, next) => {
  try {
    let { id } = req.params;
    const { textFields } = req.body;
    
    id = decodeURIComponent(id).trim();
    
    if (!id || typeof id !== 'string' || id === '') {
      return res.status(400).json({
        error: 'Invalid template ID',
        message: 'Template ID must be a non-empty string'
      });
    }
    
    if (!Array.isArray(textFields)) {
      return res.status(400).json({
        error: 'Invalid text fields',
        message: 'Text fields must be an array'
      });
    }
    
    const dbConnection = req.app.get('dbConnection');
    
    if (!dbConnection) {
      return res.status(503).json({ 
        error: 'Service unavailable',
        message: 'Database connection is not available'
      });
    }
    
    const templateModel = new Template(dbConnection);
    
    // Check if template exists
    const template = await templateModel.findById(id);
    if (!template) {
      return res.status(404).json({
        error: 'Template not found',
        message: `Template with ID '${id}' does not exist`
      });
    }
    
    // Update text fields
    const textFieldsJson = JSON.stringify(textFields);
    console.log('Updating template:', id, 'with textFields:', textFieldsJson);
    
    const result = await dbConnection.run(
      'UPDATE templates SET text_fields = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [textFieldsJson, id]
    );
    
    console.log('Database update result:', result);
    
    res.json({
      message: 'Text fields updated successfully',
      template: {
        id: template.id,
        name: template.name,
        textFields: textFields
      }
    });
    
  } catch (error) {
    next(error);
  }
});

module.exports = router;