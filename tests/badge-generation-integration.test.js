const request = require('supertest');
const express = require('express');
const DatabaseConnection = require('../server/database/connection');
const BadgeJob = require('../server/models/BadgeJob');
const Template = require('../server/models/Template');
const TemplateProcessor = require('../server/services/TemplateProcessor');
const PrintQueueManager = require('../server/services/PrintQueueManager');
const path = require('path');
const fs = require('fs');

// Create a test app for integration testing
const createTestApp = () => {
  const app = express();
  
  // JSON parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  
  // API Routes
  app.use('/api/badges', require('../server/routes/badges'));
  app.use('/api/templates', require('../server/routes/templates'));
  app.use('/api/queue', require('../server/routes/queue'));
  
  // Global error handling middleware
  app.use((err, req, res, next) => {
    const isDevelopment = process.env.NODE_ENV !== 'production';
    
    res.status(err.status || 500).json({
      error: isDevelopment ? err.message : 'Internal server error',
      ...(isDevelopment && { stack: err.stack })
    });
  });
  
  return app;
};

describe('Badge Generation Integration Tests', () => {
  let app;
  let dbConnection;
  let templateModel;
  let badgeJobModel;
  let templateProcessor;
  let queueManager;
  let testTemplateId;
  let testTemplateFilePath;

  beforeAll(async () => {
    // Create test app
    app = createTestApp();
    
    // Initialize test database connection
    dbConnection = new DatabaseConnection(':memory:');
    await dbConnection.connect();
    
    // Create database tables
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
    
    await dbConnection.run(`
      CREATE TABLE IF NOT EXISTS badge_jobs (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        uid TEXT NOT NULL,
        badge_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME,
        retry_count INTEGER DEFAULT 0,
        error_message TEXT,
        FOREIGN KEY (template_id) REFERENCES templates (id)
      )
    `);
    
    // Create test models
    templateModel = new Template(dbConnection);
    badgeJobModel = new BadgeJob(dbConnection);
    templateProcessor = new TemplateProcessor();
    
    // Create test template file
    testTemplateFilePath = path.join(__dirname, '../data/test_integration_template.indd');
    const testDir = path.dirname(testTemplateFilePath);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    fs.writeFileSync(testTemplateFilePath, 'test template content for integration');
    
    // Create test template in database
    const testTemplate = await templateModel.create({
      name: 'Integration Test Template',
      filePath: testTemplateFilePath,
      previewPath: '/images/integration-test-preview.png',
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
      },
      printerPresets: 'standard'
    });
    
    testTemplateId = testTemplate.id;
    
    // Create mock printer interface
    const mockPrinterInterface = {
      printDocument: jest.fn(async (documentPath) => {
        // Simulate successful printing
        return { success: true, documentPath };
      }),
      isConnected: jest.fn(() => true),
      getStatus: jest.fn(() => ({ connected: true, ready: true }))
    };
    
    // Create mock Socket.io
    const mockIo = {
      emit: jest.fn()
    };
    
    // Create queue manager
    queueManager = new PrintQueueManager(
      badgeJobModel,
      mockPrinterInterface,
      templateProcessor,
      mockIo,
      { maxQueueSize: 10, maxRetries: 2 }
    );
    
    // Set up app with test dependencies
    app.set('dbConnection', dbConnection);
    app.set('queueManager', queueManager);
  });

  afterAll(async () => {
    // Clean up queue manager
    if (queueManager) {
      await queueManager.cleanup();
    }
    
    // Clean up database
    if (dbConnection) {
      await dbConnection.close();
    }
    
    // Clean up test files
    if (fs.existsSync(testTemplateFilePath)) {
      fs.unlinkSync(testTemplateFilePath);
    }
    
    // Clean up temp directory
    const tempDir = path.join(__dirname, '../data/temp');
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      files.forEach(file => {
        if (file.startsWith('badge_') && file.endsWith('.png')) {
          fs.unlinkSync(path.join(tempDir, file));
        }
      });
    }
  });

  beforeEach(async () => {
    // Clean up badge jobs before each test
    await dbConnection.run('DELETE FROM badge_jobs');
    
    // Reset mock function calls
    if (queueManager.printerInterface.printDocument.mockClear) {
      queueManager.printerInterface.printDocument.mockClear();
    }
  });

  describe('Template System Integration', () => {
    it('should retrieve templates with proper structure', async () => {
      const response = await request(app)
        .get('/api/templates')
        .expect(200);

      expect(response.body).toHaveProperty('templates');
      expect(response.body.templates).toHaveLength(1);
      
      const template = response.body.templates[0];
      expect(template).toHaveProperty('id', testTemplateId);
      expect(template).toHaveProperty('name', 'Integration Test Template');
      expect(template).toHaveProperty('textFields');
      expect(template.textFields).toHaveProperty('uid');
      expect(template.textFields).toHaveProperty('badgeName');
    });

    it('should generate template preview successfully', async () => {
      const response = await request(app)
        .get(`/api/templates/${testTemplateId}/preview`)
        .expect(200);

      expect(response.headers['content-type']).toBe('image/png');
      expect(response.body).toBeInstanceOf(Buffer);
      expect(response.body.length).toBeGreaterThan(0);
      
      // Verify it's a valid PNG
      expect(response.body.slice(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
      );
    });

    it('should validate template successfully', async () => {
      const response = await request(app)
        .post(`/api/templates/${testTemplateId}/validate`)
        .expect(200);

      expect(response.body).toHaveProperty('validation');
      expect(response.body.validation).toHaveProperty('isValid', true);
      expect(response.body.validation).toHaveProperty('fileSize');
      expect(response.body.validation).toHaveProperty('extension', '.indd');
    });

    it('should return 404 for non-existent template preview', async () => {
      await request(app)
        .get('/api/templates/non-existent-id/preview')
        .expect(404);
    });

    it('should return 404 for non-existent template validation', async () => {
      await request(app)
        .post('/api/templates/non-existent-id/validate')
        .expect(404);
    });
  });

  describe('Badge Generation Pipeline', () => {
    it('should generate badge preview without creating job', async () => {
      const badgeData = {
        templateId: testTemplateId,
        uid: 'PREVIEW001',
        badgeName: 'Preview Test'
      };

      const response = await request(app)
        .post('/api/badges/preview')
        .send(badgeData)
        .expect(200);

      expect(response.headers['content-type']).toBe('image/png');
      expect(response.body).toBeInstanceOf(Buffer);
      expect(response.body.length).toBeGreaterThan(0);
      
      // Verify it's a valid PNG
      expect(response.body.slice(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
      );
      
      // Verify no job was created
      const jobs = await badgeJobModel.findAll();
      expect(jobs).toHaveLength(0);
    });

    it('should create badge job with template validation', async () => {
      const badgeData = {
        templateId: testTemplateId,
        uid: 'TEST001',
        badgeName: 'John Doe'
      };

      const response = await request(app)
        .post('/api/badges')
        .send(badgeData)
        .expect(201);

      expect(response.body).toHaveProperty('job');
      expect(response.body.job).toHaveProperty('templateId', testTemplateId);
      expect(response.body.job).toHaveProperty('uid', 'TEST001');
      expect(response.body.job).toHaveProperty('badgeName', 'John Doe');
      expect(response.body.job).toHaveProperty('status', 'queued');
    });

    it('should reject badge creation with invalid template', async () => {
      const badgeData = {
        templateId: 'non-existent-template',
        uid: 'TEST002',
        badgeName: 'Jane Doe'
      };

      const response = await request(app)
        .post('/api/badges')
        .send(badgeData)
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Template not found');
      expect(response.body).toHaveProperty('field', 'templateId');
    });

    it('should reject badge preview with invalid template', async () => {
      const badgeData = {
        templateId: 'non-existent-template',
        uid: 'PREVIEW002',
        badgeName: 'Preview Test'
      };

      await request(app)
        .post('/api/badges/preview')
        .send(badgeData)
        .expect(404);
    });
  });

  describe('End-to-End Badge Creation Workflow', () => {
    it('should complete full badge creation workflow', async () => {
      // Step 1: Get available templates
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      expect(templatesResponse.body.templates).toHaveLength(1);
      const template = templatesResponse.body.templates[0];

      // Step 2: Validate selected template
      const validationResponse = await request(app)
        .post(`/api/templates/${template.id}/validate`)
        .expect(200);
      
      expect(validationResponse.body.validation.isValid).toBe(true);

      // Step 3: Generate preview
      const previewData = {
        templateId: template.id,
        uid: 'WORKFLOW001',
        badgeName: 'Workflow Test'
      };

      const previewResponse = await request(app)
        .post('/api/badges/preview')
        .send(previewData)
        .expect(200);
      
      expect(previewResponse.headers['content-type']).toBe('image/png');

      // Step 4: Create badge job
      const jobResponse = await request(app)
        .post('/api/badges')
        .send(previewData)
        .expect(201);
      
      expect(jobResponse.body.job).toHaveProperty('status', 'queued');
      const jobId = jobResponse.body.job.id;

      // Step 5: Check queue status
      const queueResponse = await request(app)
        .get('/api/queue')
        .expect(200);
      
      expect(queueResponse.body.queue.stats.queued).toBeGreaterThan(0);

      // Step 6: Wait for job processing (simulate)
      // In a real scenario, the queue manager would process this automatically
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify job was created in database
      const job = await badgeJobModel.findById(jobId);
      expect(job).toBeTruthy();
      expect(job.templateId).toBe(template.id);
      expect(job.uid).toBe('WORKFLOW001');
      expect(job.badgeName).toBe('Workflow Test');
    });

    it('should handle multiple concurrent badge requests', async () => {
      const badgeRequests = [
        { templateId: testTemplateId, uid: 'CONCURRENT001', badgeName: 'User One' },
        { templateId: testTemplateId, uid: 'CONCURRENT002', badgeName: 'User Two' },
        { templateId: testTemplateId, uid: 'CONCURRENT003', badgeName: 'User Three' }
      ];

      // Submit all requests concurrently
      const responses = await Promise.all(
        badgeRequests.map(data => 
          request(app)
            .post('/api/badges')
            .send(data)
            .expect(201)
        )
      );

      // Verify all jobs were created
      expect(responses).toHaveLength(3);
      responses.forEach((response, index) => {
        expect(response.body.job.uid).toBe(badgeRequests[index].uid);
        expect(response.body.job.badgeName).toBe(badgeRequests[index].badgeName);
      });

      // Verify queue status reflects all jobs
      const queueResponse = await request(app)
        .get('/api/queue')
        .expect(200);
      
      expect(queueResponse.body.queue.stats.queued).toBe(3);
    });

    it('should prevent duplicate UID submissions', async () => {
      const badgeData = {
        templateId: testTemplateId,
        uid: 'DUPLICATE001',
        badgeName: 'First User'
      };

      // First submission should succeed
      await request(app)
        .post('/api/badges')
        .send(badgeData)
        .expect(201);

      // Second submission with same UID should fail
      const duplicateData = {
        ...badgeData,
        badgeName: 'Second User'
      };

      const response = await request(app)
        .post('/api/badges')
        .send(duplicateData)
        .expect(409);

      expect(response.body).toHaveProperty('error', 'Duplicate UID');
      expect(response.body).toHaveProperty('field', 'uid');
    });
  });

  describe('Template File Format Support', () => {
    let testTemplates = [];

    beforeAll(async () => {
      // Create test files for different formats
      const supportedFormats = ['.png', '.jpg', '.jpeg', '.pdf'];
      
      for (const format of supportedFormats) {
        const filePath = path.join(__dirname, `../data/test_format${format}`);
        fs.writeFileSync(filePath, 'test content for format testing');
        
        const template = await templateModel.create({
          name: `Test ${format.toUpperCase()} Template`,
          filePath: filePath,
          textFields: {
            uid: { x: 50, y: 100, fontSize: 12, fontFamily: 'Arial' },
            badgeName: { x: 50, y: 150, fontSize: 16, fontFamily: 'Arial Bold' }
          }
        });
        
        testTemplates.push({ template, filePath });
      }
    });

    afterAll(async () => {
      // Clean up test template files
      for (const { template, filePath } of testTemplates) {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        try {
          await templateModel.delete(template.id);
        } catch (error) {
          // Template might already be deleted
        }
      }
    });

    it('should validate different template file formats', async () => {
      for (const { template } of testTemplates) {
        const response = await request(app)
          .post(`/api/templates/${template.id}/validate`)
          .expect(200);

        expect(response.body.validation.isValid).toBe(true);
        expect(response.body.template.name).toContain('Test');
      }
    });

    it('should generate previews for different template formats', async () => {
      for (const { template } of testTemplates) {
        const response = await request(app)
          .get(`/api/templates/${template.id}/preview`)
          .expect(200);

        expect(response.headers['content-type']).toBe('image/png');
        expect(response.body.length).toBeGreaterThan(0);
      }
    });

    it('should create badges using different template formats', async () => {
      for (const { template } of testTemplates) {
        const badgeData = {
          templateId: template.id,
          uid: `FORMAT_${template.id.slice(-6)}`,
          badgeName: `Format Test ${template.name}`
        };

        const response = await request(app)
          .post('/api/badges')
          .send(badgeData)
          .expect(201);

        expect(response.body.job.templateId).toBe(template.id);
      }
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle template file deletion gracefully', async () => {
      // Create a template and then delete its file
      const tempFilePath = path.join(__dirname, '../data/temp_delete_test.indd');
      fs.writeFileSync(tempFilePath, 'temporary test content');
      
      const template = await templateModel.create({
        name: 'Delete Test Template',
        filePath: tempFilePath,
        textFields: {
          uid: { x: 50, y: 100, fontSize: 12, fontFamily: 'Arial' },
          badgeName: { x: 50, y: 150, fontSize: 16, fontFamily: 'Arial Bold' }
        }
      });
      
      // Delete the file
      fs.unlinkSync(tempFilePath);
      
      // Template validation should fail
      const validationResponse = await request(app)
        .post(`/api/templates/${template.id}/validate`)
        .expect(200);
      
      expect(validationResponse.body.validation.isValid).toBe(false);
      expect(validationResponse.body.validation.error).toContain('does not exist');
      
      // Badge creation should fail
      const badgeData = {
        templateId: template.id,
        uid: 'DELETE_TEST',
        badgeName: 'Delete Test'
      };
      
      await request(app)
        .post('/api/badges')
        .send(badgeData)
        .expect(400);
      
      // Clean up
      await templateModel.delete(template.id);
    });

    it('should handle invalid badge data gracefully', async () => {
      const invalidDataSets = [
        { templateId: testTemplateId, uid: '', badgeName: 'Test' }, // Empty UID
        { templateId: testTemplateId, uid: 'TEST', badgeName: '' }, // Empty badge name
        { templateId: testTemplateId, uid: 'TEST@INVALID', badgeName: 'Test' }, // Invalid UID characters
        { templateId: testTemplateId, uid: 'A'.repeat(51), badgeName: 'Test' }, // UID too long
        { templateId: testTemplateId, uid: 'TEST', badgeName: 'A'.repeat(101) } // Badge name too long
      ];

      for (const invalidData of invalidDataSets) {
        await request(app)
          .post('/api/badges')
          .send(invalidData)
          .expect(400);
      }
    });

    it('should handle queue capacity limits', async () => {
      // Fill up the queue to capacity (maxQueueSize = 10)
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          request(app)
            .post('/api/badges')
            .send({
              templateId: testTemplateId,
              uid: `CAPACITY${i.toString().padStart(3, '0')}`,
              badgeName: `Capacity Test ${i}`
            })
            .expect(201)
        );
      }
      
      await Promise.all(promises);
      
      // Next request should fail due to capacity
      await request(app)
        .post('/api/badges')
        .send({
          templateId: testTemplateId,
          uid: 'OVERFLOW001',
          badgeName: 'Overflow Test'
        })
        .expect(500); // Queue manager will throw capacity error
    });
  });
});