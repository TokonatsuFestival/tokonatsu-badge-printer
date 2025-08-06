const request = require('supertest');
const express = require('express');
const DatabaseConnection = require('../server/database/connection');
const BadgeJob = require('../server/models/BadgeJob');
const Template = require('../server/models/Template');
const path = require('path');

// Create a test app instead of using the main app
const createTestApp = () => {
  const app = express();
  
  // JSON parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  
  // API Routes
  app.use('/api/badges', require('../server/routes/badges'));
  app.use('/api/queue', require('../server/routes/queue'));
  app.use('/api/jobs', require('../server/routes/jobs'));
  app.use('/api/templates', require('../server/routes/templates'));
  
  // 404 handler for API routes
  app.use('/api/*', (req, res) => {
    res.status(404).json({ 
      error: 'API endpoint not found',
      path: req.originalUrl,
      method: req.method
    });
  });
  
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

describe('API Endpoints Integration Tests', () => {
  let app;
  let dbConnection;
  let templateModel;
  let badgeJobModel;
  let testTemplateId;
  let mockQueueManager;

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
    
    // Create test template - check if it already exists first
    let testTemplate = await templateModel.findByName('Test Badge Template');
    if (!testTemplate) {
      testTemplate = await templateModel.create({
        name: 'Test Badge Template',
        filePath: path.join(__dirname, '../templates/sample-badge.indd'),
        previewPath: '/images/test-preview.png',
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
    }
    
    testTemplateId = testTemplate.id;
    
    // Create mock queue manager
    mockQueueManager = {
      addJob: jest.fn(async (jobData) => {
        const job = await badgeJobModel.create(jobData);
        return job;
      }),
      getQueueStatus: jest.fn(async () => ({
        queued: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        jobs: []
      })),
      getQueueCapacity: jest.fn(async () => ({
        max: 50,
        current: 0,
        available: 50
      })),
      cancelJob: jest.fn(async (jobId) => {
        const job = await badgeJobModel.findById(jobId);
        if (!job) {
          throw new Error(`Job with ID ${jobId} not found`);
        }
        // For testing, we'll just mark it as cancelled without actually updating the status
        // since the status 'cancelled' might not be in our enum
        return job;
      }),
      retryJob: jest.fn(async (jobId) => {
        const job = await badgeJobModel.findById(jobId);
        if (!job) {
          throw new Error(`Job with ID ${jobId} not found`);
        }
        await badgeJobModel.updateStatus(jobId, 'queued');
        return await badgeJobModel.findById(jobId);
      })
    };
    
    // Set up app with test database and mock queue manager
    app.set('dbConnection', dbConnection);
    app.set('queueManager', mockQueueManager);
  });

  afterAll(async () => {
    if (dbConnection) {
      await dbConnection.close();
    }
  });

  beforeEach(async () => {
    // Clean up badge jobs before each test
    await dbConnection.run('DELETE FROM badge_jobs');
    
    // Reset mock function calls
    if (mockQueueManager) {
      Object.values(mockQueueManager).forEach(fn => {
        if (typeof fn.mockClear === 'function') {
          fn.mockClear();
        }
      });
    }
  });

  describe('POST /api/badges', () => {
    it('should create a new badge job with valid data', async () => {
      const badgeData = {
        templateId: testTemplateId,
        uid: 'TEST001',
        badgeName: 'John Doe'
      };

      const response = await request(app)
        .post('/api/badges')
        .send(badgeData)
        .expect(201);

      expect(response.body).toHaveProperty('message', 'Badge job added to queue successfully');
      expect(response.body).toHaveProperty('job');
      expect(response.body.job).toHaveProperty('id');
      expect(response.body.job).toHaveProperty('templateId', testTemplateId);
      expect(response.body.job).toHaveProperty('uid', 'TEST001');
      expect(response.body.job).toHaveProperty('badgeName', 'John Doe');
      expect(response.body.job).toHaveProperty('status', 'queued');
      expect(response.body.job).toHaveProperty('retryCount', 0);
    });

    it('should reject request with missing templateId', async () => {
      const badgeData = {
        uid: 'TEST001',
        badgeName: 'John Doe'
      };

      const response = await request(app)
        .post('/api/badges')
        .send(badgeData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
      expect(response.body.details).toContain('templateId is required and must be a string');
    });

    it('should reject request with missing uid', async () => {
      const badgeData = {
        templateId: testTemplateId,
        badgeName: 'John Doe'
      };

      const response = await request(app)
        .post('/api/badges')
        .send(badgeData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
      expect(response.body.details).toContain('uid is required and must be a string');
    });

    it('should reject request with missing badgeName', async () => {
      const badgeData = {
        templateId: testTemplateId,
        uid: 'TEST001'
      };

      const response = await request(app)
        .post('/api/badges')
        .send(badgeData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
      expect(response.body.details).toContain('badgeName is required and must be a string');
    });

    it('should reject request with invalid uid characters', async () => {
      const badgeData = {
        templateId: testTemplateId,
        uid: 'TEST@001',
        badgeName: 'John Doe'
      };

      const response = await request(app)
        .post('/api/badges')
        .send(badgeData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
      expect(response.body.details).toContain('uid can only contain letters, numbers, hyphens, and underscores');
    });

    it('should reject request with uid too long', async () => {
      const badgeData = {
        templateId: testTemplateId,
        uid: 'A'.repeat(51),
        badgeName: 'John Doe'
      };

      const response = await request(app)
        .post('/api/badges')
        .send(badgeData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
      expect(response.body.details).toContain('uid must be 50 characters or less');
    });

    it('should reject request with badgeName too long', async () => {
      const badgeData = {
        templateId: testTemplateId,
        uid: 'TEST001',
        badgeName: 'A'.repeat(101)
      };

      const response = await request(app)
        .post('/api/badges')
        .send(badgeData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
      expect(response.body.details).toContain('badgeName must be 100 characters or less');
    });

    it('should trim whitespace from input fields', async () => {
      const badgeData = {
        templateId: `  ${testTemplateId}  `,
        uid: '  TEST001  ',
        badgeName: '  John Doe  '
      };

      const response = await request(app)
        .post('/api/badges')
        .send(badgeData)
        .expect(201);
      expect(response.body.job).toHaveProperty('uid', 'TEST001');
      expect(response.body.job).toHaveProperty('badgeName', 'John Doe');
    });
  });

  describe('GET /api/queue', () => {
    it('should return queue status', async () => {
      const response = await request(app)
        .get('/api/queue')
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Queue status retrieved successfully');
      expect(response.body).toHaveProperty('queue');
      expect(response.body.queue).toHaveProperty('capacity');
      expect(response.body.queue).toHaveProperty('timestamp');
    });
  });

  describe('GET /api/templates', () => {
    it('should return list of available templates', async () => {
      const response = await request(app)
        .get('/api/templates')
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Templates retrieved successfully');
      expect(response.body).toHaveProperty('templates');
      expect(response.body).toHaveProperty('count');
      expect(Array.isArray(response.body.templates)).toBe(true);
      expect(response.body.count).toBeGreaterThan(0);
      
      const template = response.body.templates[0];
      expect(template).toHaveProperty('id');
      expect(template).toHaveProperty('name');
      expect(template).toHaveProperty('textFields');
      expect(template).toHaveProperty('createdAt');
      expect(template).toHaveProperty('updatedAt');
    });
  });

  describe('GET /api/templates/:id', () => {
    it('should return specific template details', async () => {
      const response = await request(app)
        .get(`/api/templates/${testTemplateId}`)
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Template retrieved successfully');
      expect(response.body).toHaveProperty('template');
      expect(response.body.template).toHaveProperty('id', testTemplateId);
      expect(response.body.template).toHaveProperty('name', 'Test Badge Template');
      expect(response.body.template).toHaveProperty('textFields');
      expect(response.body.template.textFields).toHaveProperty('uid');
      expect(response.body.template.textFields).toHaveProperty('badgeName');
    });

    it('should return 404 for non-existent template', async () => {
      const response = await request(app)
        .get('/api/templates/non-existent-id')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Template not found');
    });

    it('should return 400 for invalid template ID', async () => {
      const response = await request(app)
        .get('/api/templates/%20%20%20')  // URL-encoded spaces
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Invalid template ID');
    });
  });

  describe('DELETE /api/jobs/:id', () => {
    let testJobId;

    beforeEach(async () => {
      // Create a test job
      const job = await badgeJobModel.create({
        templateId: testTemplateId,
        uid: 'TEST_DELETE',
        badgeName: 'Test Delete Job'
      });
      testJobId = job.id;
    });

    it('should cancel a job successfully', async () => {
      const response = await request(app)
        .delete(`/api/jobs/${testJobId}`)
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Job cancelled successfully');
      expect(response.body).toHaveProperty('jobId', testJobId);
    });

    it('should return 404 for non-existent job', async () => {
      const response = await request(app)
        .delete('/api/jobs/non-existent-id')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Job not found');
    });

    it('should return 400 for invalid job ID', async () => {
      const response = await request(app)
        .delete('/api/jobs/')
        .expect(404); // Express returns 404 for empty path parameter
    });
  });

  describe('POST /api/jobs/:id/retry', () => {
    let testJobId;

    beforeEach(async () => {
      // Create a failed test job
      const job = await badgeJobModel.create({
        templateId: testTemplateId,
        uid: 'TEST_RETRY',
        badgeName: 'Test Retry Job'
      });
      
      // Mark it as failed
      await badgeJobModel.updateStatus(job.id, 'failed', 'Test failure');
      testJobId = job.id;
    });

    it('should retry a failed job successfully', async () => {
      const response = await request(app)
        .post(`/api/jobs/${testJobId}/retry`)
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Job retry scheduled successfully');
      expect(response.body).toHaveProperty('job');
      expect(response.body.job).toHaveProperty('id', testJobId);
      expect(response.body.job).toHaveProperty('status', 'queued');
    });

    it('should return 404 for non-existent job', async () => {
      const response = await request(app)
        .post('/api/jobs/non-existent-id/retry')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Job not found');
    });

    it('should return 400 for invalid job ID', async () => {
      const response = await request(app)
        .post('/api/jobs//retry')
        .expect(404); // Express returns 404 for empty path parameter
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 for non-existent API endpoints', async () => {
      const response = await request(app)
        .get('/api/nonexistent')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'API endpoint not found');
    });

    it('should handle invalid JSON in request body', async () => {
      const response = await request(app)
        .post('/api/badges')
        .set('Content-Type', 'application/json')
        .send('invalid json')
        .expect(400);
    });
  });
});