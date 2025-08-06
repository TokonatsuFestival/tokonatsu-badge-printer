const request = require('supertest');
const express = require('express');
const DatabaseConnection = require('../server/database/connection');
const Template = require('../server/models/Template');
const path = require('path');
const fs = require('fs');

// Create a simple test app
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/templates', require('../server/routes/templates'));
  app.use('/api/badges', require('../server/routes/badges'));
  
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error'
    });
  });
  
  return app;
};

describe('Template Integration - Simple Tests', () => {
  let app;
  let dbConnection;
  let templateModel;
  let testTemplateId;
  let testTemplateFilePath;

  beforeAll(async () => {
    app = createTestApp();
    
    // Initialize test database
    dbConnection = new DatabaseConnection(':memory:');
    await dbConnection.connect();
    
    // Create templates table
    await dbConnection.run(`
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        preview_path TEXT,
        text_fields TEXT NOT NULL,
        printer_presets TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    templateModel = new Template(dbConnection);
    
    // Create test template file
    testTemplateFilePath = path.join(__dirname, '../data/simple_test_template.indd');
    const testDir = path.dirname(testTemplateFilePath);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    fs.writeFileSync(testTemplateFilePath, 'simple test template content');
    
    // Create test template
    const testTemplate = await templateModel.create({
      name: 'Simple Test Template',
      filePath: testTemplateFilePath,
      textFields: {
        uid: {
          x: 100,
          y: 200,
          fontSize: 14,
          fontFamily: 'Arial'
        },
        badgeName: {
          x: 100,
          y: 250,
          fontSize: 16,
          fontFamily: 'Arial Bold'
        }
      }
    });
    
    testTemplateId = testTemplate.id;
    
    // Set up app with database connection
    app.set('dbConnection', dbConnection);
  });

  afterAll(async () => {
    if (fs.existsSync(testTemplateFilePath)) {
      fs.unlinkSync(testTemplateFilePath);
    }
    
    if (dbConnection) {
      await dbConnection.close();
    }
  });

  describe('Template Preview Generation', () => {
    it('should generate template preview successfully', async () => {
      const response = await request(app)
        .get(`/api/templates/${testTemplateId}/preview`)
        .expect(200);

      expect(response.headers['content-type']).toBe('image/png');
      expect(response.body).toBeInstanceOf(Buffer);
      expect(response.body.length).toBeGreaterThan(0);
      
      // Verify PNG signature
      const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      expect(response.body.slice(0, 8)).toEqual(pngSignature);
    });

    it('should return 404 for non-existent template preview', async () => {
      await request(app)
        .get('/api/templates/non-existent-id/preview')
        .expect(404);
    });
  });

  describe('Template Validation', () => {
    it('should validate template successfully', async () => {
      const response = await request(app)
        .post(`/api/templates/${testTemplateId}/validate`)
        .expect(200);

      expect(response.body).toHaveProperty('validation');
      expect(response.body.validation).toHaveProperty('isValid', true);
      expect(response.body.validation).toHaveProperty('extension', '.indd');
      expect(response.body.template).toHaveProperty('id', testTemplateId);
    });

    it('should return 404 for non-existent template validation', async () => {
      await request(app)
        .post('/api/templates/non-existent-id/validate')
        .expect(404);
    });
  });

  describe('Badge Preview Generation', () => {
    it('should generate badge preview successfully', async () => {
      const badgeData = {
        templateId: testTemplateId,
        uid: 'PREVIEW001',
        badgeName: 'Preview Test User'
      };

      const response = await request(app)
        .post('/api/badges/preview')
        .send(badgeData)
        .expect(200);

      expect(response.headers['content-type']).toBe('image/png');
      expect(response.body).toBeInstanceOf(Buffer);
      expect(response.body.length).toBeGreaterThan(0);
      
      // Verify PNG signature
      const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      expect(response.body.slice(0, 8)).toEqual(pngSignature);
    });

    it('should reject badge preview with invalid template', async () => {
      const badgeData = {
        templateId: 'non-existent-template',
        uid: 'PREVIEW002',
        badgeName: 'Preview Test User'
      };

      await request(app)
        .post('/api/badges/preview')
        .send(badgeData)
        .expect(404);
    });

    it('should reject badge preview with invalid data', async () => {
      const badgeData = {
        templateId: testTemplateId,
        uid: '', // Empty UID
        badgeName: 'Preview Test User'
      };

      await request(app)
        .post('/api/badges/preview')
        .send(badgeData)
        .expect(400);
    });
  });

  describe('Template Integration Workflow', () => {
    it('should complete template selection to preview workflow', async () => {
      // Step 1: Get template details
      const templateResponse = await request(app)
        .get(`/api/templates/${testTemplateId}`)
        .expect(200);
      
      expect(templateResponse.body.template).toHaveProperty('id', testTemplateId);
      expect(templateResponse.body.template).toHaveProperty('textFields');

      // Step 2: Validate template
      const validationResponse = await request(app)
        .post(`/api/templates/${testTemplateId}/validate`)
        .expect(200);
      
      expect(validationResponse.body.validation.isValid).toBe(true);

      // Step 3: Generate template preview
      const templatePreviewResponse = await request(app)
        .get(`/api/templates/${testTemplateId}/preview`)
        .expect(200);
      
      expect(templatePreviewResponse.headers['content-type']).toBe('image/png');

      // Step 4: Generate badge preview with user data
      const badgePreviewResponse = await request(app)
        .post('/api/badges/preview')
        .send({
          templateId: testTemplateId,
          uid: 'WORKFLOW001',
          badgeName: 'Workflow Test User'
        })
        .expect(200);
      
      expect(badgePreviewResponse.headers['content-type']).toBe('image/png');
      
      // Verify both previews are valid PNG images
      const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      expect(templatePreviewResponse.body.slice(0, 8)).toEqual(pngSignature);
      expect(badgePreviewResponse.body.slice(0, 8)).toEqual(pngSignature);
    });
  });
});