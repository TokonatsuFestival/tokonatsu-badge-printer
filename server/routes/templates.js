const express = require('express');
const Template = require('../models/Template');
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

module.exports = router;