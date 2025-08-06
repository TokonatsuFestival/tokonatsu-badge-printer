const request = require('supertest');
const express = require('express');
const DatabaseConnection = require('../server/database/connection');
const BadgeJob = require('../server/models/BadgeJob');
const Template = require('../server/models/Template');
const PrintQueueManager = require('../server/services/PrintQueueManager');
const path = require('path');

// Create a test app for job management testing
const createTestApp = () => {
  const app = express();
  
  // JSON parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  
  // API Routes
  app.use('/api/jobs', require('../server/routes/jobs'));
  
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

describe('Job Management Integration Tests', () => {
  let app;
  let dbConnection;
  let templateModel;
  let badgeJobModel;
  let queueManager;
  let testTemplateId;
  let mockPrinterInterface;
  let mockTemplateProcessor;

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
    let testTemplate = await templateModel.findByName('Job Management Test Template');
    if (!testTemplate) {
      testTemplate = await templateModel.create({
        name: 'Job Management Test Template',
        filePath: path.join(__dirname, '../templates/sample-badge.indd'),
        previewPath: '/images/test-preview.png',
        textFields: {
          uid: { x: 100, y: 200, fontSize: 14, fontFamily: 'Arial' },
          badgeName: { x: 100, y: 250, fontSize: 16, fontFamily: 'Arial Bold' }
        },
        printerPresets: 'standard'
      });
    }
    
    testTemplateId = testTemplate.id;
    
    // Create mock services
    mockPrinterInterface = {
      printDocument: jest.fn().mockResolvedValue(true),
      getPrinterStatus: jest.fn().mockResolvedValue({ connected: true })
    };
    
    mockTemplateProcessor = {
      generateBadge: jest.fn().mockResolvedValue('/tmp/badge.pdf')
    };
    
    // Create real queue manager for integration testing
    queueManager = new PrintQueueManager(
      badgeJobModel,
      mockPrinterInterface,
      mockTemplateProcessor,
      { emit: jest.fn() }, // Mock Socket.io
      {
        maxQueueSize: 10,
        maxRetries: 3,
        retryBaseDelay: 100,
        processingTimeout: 1000
      }
    );
    
    // Stop automatic processing for tests to avoid race conditions
    queueManager.stopProcessing();
    
    // Set up app with test database and queue manager
    app.set('dbConnection', dbConnection);
    app.set('queueManager', queueManager);
  });

  afterAll(async () => {
    if (queueManager) {
      await queueManager.cleanup();
    }
    if (dbConnection) {
      await dbConnection.close();
    }
  });

  beforeEach(async () => {
    // Clean up badge jobs before each test
    await dbConnection.run('DELETE FROM badge_jobs');
    
    // Reset mock function calls
    mockPrinterInterface.printDocument.mockClear();
    mockTemplateProcessor.generateBadge.mockClear();
  });

  describe('Job Cancellation', () => {
    it('should cancel a queued job successfully', async () => {
      // Create a test job
      const job = await badgeJobModel.create({
        templateId: testTemplateId,
        uid: 'CANCEL_TEST_001',
        badgeName: 'Cancel Test Job'
      });

      const response = await request(app)
        .delete(`/api/jobs/${job.id}`)
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Job cancelled successfully');
      expect(response.body).toHaveProperty('jobId', job.id);

      // Verify job is deleted from database
      const deletedJob = await badgeJobModel.findById(job.id);
      expect(deletedJob).toBeNull();
    });

    it('should cancel a processing job successfully', async () => {
      // Create and mark job as processing
      const job = await badgeJobModel.create({
        templateId: testTemplateId,
        uid: 'CANCEL_PROCESSING_001',
        badgeName: 'Cancel Processing Job'
      });
      
      await badgeJobModel.updateStatus(job.id, 'processing');

      const response = await request(app)
        .delete(`/api/jobs/${job.id}`)
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Job cancelled successfully');
      
      // Verify job is deleted
      const deletedJob = await badgeJobModel.findById(job.id);
      expect(deletedJob).toBeNull();
    });

    it('should not cancel a completed job', async () => {
      // Create and mark job as completed
      const job = await badgeJobModel.create({
        templateId: testTemplateId,
        uid: 'COMPLETED_001',
        badgeName: 'Completed Job'
      });
      
      await badgeJobModel.updateStatus(job.id, 'completed');

      const response = await request(app)
        .delete(`/api/jobs/${job.id}`)
        .expect(409);

      expect(response.body).toHaveProperty('error', 'Job cannot be cancelled');
      
      // Verify job still exists
      const existingJob = await badgeJobModel.findById(job.id);
      expect(existingJob).not.toBeNull();
      expect(existingJob.status).toBe('completed');
    });

    it('should return 404 for non-existent job cancellation', async () => {
      const response = await request(app)
        .delete('/api/jobs/non-existent-id')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Job not found');
    });
  });

  describe('Job Retry', () => {
    it('should retry a failed job successfully', async () => {
      // Create and mark job as failed
      const job = await badgeJobModel.create({
        templateId: testTemplateId,
        uid: 'RETRY_TEST_001',
        badgeName: 'Retry Test Job'
      });
      
      await badgeJobModel.updateStatus(job.id, 'failed', 'Test failure');

      const response = await request(app)
        .post(`/api/jobs/${job.id}/retry`)
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Job retry scheduled successfully');
      expect(response.body.job).toHaveProperty('status', 'queued');
      expect(response.body.job).toHaveProperty('id', job.id);
      
      // Verify job status in database
      const retriedJob = await badgeJobModel.findById(job.id);
      expect(retriedJob.status).toBe('queued');
    });

    it('should not retry a job that has exceeded max retries', async () => {
      // Create job and set retry count to max
      const job = await badgeJobModel.create({
        templateId: testTemplateId,
        uid: 'MAX_RETRY_001',
        badgeName: 'Max Retry Job'
      });
      
      // Simulate max retries
      await badgeJobModel.updateStatus(job.id, 'failed', 'Test failure');
      await badgeJobModel.incrementRetryCount(job.id);
      await badgeJobModel.incrementRetryCount(job.id);
      await badgeJobModel.incrementRetryCount(job.id);

      const response = await request(app)
        .post(`/api/jobs/${job.id}/retry`)
        .expect(409);

      expect(response.body).toHaveProperty('error', 'Job cannot be retried');
      expect(response.body.message).toContain('maximum retry attempts');
    });

    it('should not retry a non-failed job', async () => {
      // Create queued job
      const job = await badgeJobModel.create({
        templateId: testTemplateId,
        uid: 'QUEUED_RETRY_001',
        badgeName: 'Queued Job'
      });

      const response = await request(app)
        .post(`/api/jobs/${job.id}/retry`)
        .expect(409);

      expect(response.body).toHaveProperty('error', 'Job cannot be retried');
      expect(response.body.message).toContain('Only failed jobs can be retried');
    });

    it('should return 404 for non-existent job retry', async () => {
      const response = await request(app)
        .post('/api/jobs/non-existent-id/retry')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Job not found');
    });
  });

  describe('Job History', () => {
    beforeEach(async () => {
      // Create test jobs with different statuses
      const jobs = [
        { uid: 'HISTORY_001', badgeName: 'Completed Job 1', status: 'completed' },
        { uid: 'HISTORY_002', badgeName: 'Failed Job 1', status: 'failed' },
        { uid: 'HISTORY_003', badgeName: 'Completed Job 2', status: 'completed' },
        { uid: 'HISTORY_004', badgeName: 'Queued Job 1', status: 'queued' },
        { uid: 'HISTORY_005', badgeName: 'Failed Job 2', status: 'failed' }
      ];

      for (const jobData of jobs) {
        const job = await badgeJobModel.create({
          templateId: testTemplateId,
          uid: jobData.uid,
          badgeName: jobData.badgeName
        });
        
        if (jobData.status !== 'queued') {
          await badgeJobModel.updateStatus(job.id, jobData.status, 
            jobData.status === 'failed' ? 'Test error' : null);
        }
      }
    });

    it('should return job history with completed and failed jobs', async () => {
      const response = await request(app)
        .get('/api/jobs/history')
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Job history retrieved successfully');
      expect(response.body).toHaveProperty('jobs');
      expect(response.body).toHaveProperty('pagination');
      
      // Should return 4 jobs (2 completed + 2 failed, excluding 1 queued)
      expect(response.body.jobs).toHaveLength(4);
      expect(response.body.pagination.total).toBe(4);
      
      // Verify jobs are sorted by processed_at DESC
      const jobs = response.body.jobs;
      for (let i = 0; i < jobs.length - 1; i++) {
        const current = new Date(jobs[i].processedAt || jobs[i].createdAt);
        const next = new Date(jobs[i + 1].processedAt || jobs[i + 1].createdAt);
        expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
      }
    });

    it('should filter job history by status', async () => {
      const response = await request(app)
        .get('/api/jobs/history?status=completed')
        .expect(200);

      expect(response.body.jobs).toHaveLength(2);
      expect(response.body.pagination.total).toBe(2);
      
      // All jobs should be completed
      response.body.jobs.forEach(job => {
        expect(job.status).toBe('completed');
      });
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/jobs/history?limit=2&offset=0')
        .expect(200);

      expect(response.body.jobs).toHaveLength(2);
      expect(response.body.pagination.limit).toBe(2);
      expect(response.body.pagination.offset).toBe(0);
      expect(response.body.pagination.total).toBe(4);
      expect(response.body.pagination.hasMore).toBe(true);
    });

    it('should handle invalid status filter gracefully', async () => {
      const response = await request(app)
        .get('/api/jobs/history?status=invalid')
        .expect(200);

      // Should return all completed and failed jobs (ignoring invalid filter)
      expect(response.body.jobs).toHaveLength(4);
    });
  });

  describe('Manual Intervention', () => {
    let processingJobId;
    let failedJobId;

    beforeEach(async () => {
      // Create processing job
      const processingJob = await badgeJobModel.create({
        templateId: testTemplateId,
        uid: 'PROCESSING_001',
        badgeName: 'Processing Job'
      });
      await badgeJobModel.updateStatus(processingJob.id, 'processing');
      processingJobId = processingJob.id;

      // Create failed job
      const failedJob = await badgeJobModel.create({
        templateId: testTemplateId,
        uid: 'FAILED_001',
        badgeName: 'Failed Job'
      });
      await badgeJobModel.updateStatus(failedJob.id, 'failed', 'Test failure');
      failedJobId = failedJob.id;
    });

    it('should reset a processing job to queued', async () => {
      const response = await request(app)
        .post(`/api/jobs/${processingJobId}/manual-intervention`)
        .send({ action: 'reset', reason: 'Manual reset for testing' })
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Manual intervention completed: reset');
      expect(response.body.job).toHaveProperty('status', 'queued');
      expect(response.body.intervention).toHaveProperty('action', 'reset');
      expect(response.body.intervention).toHaveProperty('reason', 'Manual reset for testing');
      
      // Verify in database
      const updatedJob = await badgeJobModel.findById(processingJobId);
      expect(updatedJob.status).toBe('queued');
    });

    it('should mark a processing job as failed', async () => {
      const response = await request(app)
        .post(`/api/jobs/${processingJobId}/manual-intervention`)
        .send({ action: 'fail', reason: 'Manual failure' })
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Manual intervention completed: fail');
      expect(response.body.job).toHaveProperty('status', 'failed');
      expect(response.body.job).toHaveProperty('errorMessage', 'Manual failure');
      
      // Verify in database
      const updatedJob = await badgeJobModel.findById(processingJobId);
      expect(updatedJob.status).toBe('failed');
      expect(updatedJob.errorMessage).toBe('Manual failure');
    });

    it('should mark a processing job as completed', async () => {
      const response = await request(app)
        .post(`/api/jobs/${processingJobId}/manual-intervention`)
        .send({ action: 'complete', reason: 'Manual completion' })
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Manual intervention completed: complete');
      expect(response.body.job).toHaveProperty('status', 'completed');
      
      // Verify in database
      const updatedJob = await badgeJobModel.findById(processingJobId);
      expect(updatedJob.status).toBe('completed');
      expect(updatedJob.processedAt).not.toBeNull();
    });

    it('should reset a failed job to queued', async () => {
      const response = await request(app)
        .post(`/api/jobs/${failedJobId}/manual-intervention`)
        .send({ action: 'reset' })
        .expect(200);

      expect(response.body.job).toHaveProperty('status', 'queued');
      
      // Verify in database
      const updatedJob = await badgeJobModel.findById(failedJobId);
      expect(updatedJob.status).toBe('queued');
    });

    it('should reject invalid action', async () => {
      const response = await request(app)
        .post(`/api/jobs/${processingJobId}/manual-intervention`)
        .send({ action: 'invalid' })
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Invalid action');
    });

    it('should reject intervention on completed job', async () => {
      // Create completed job
      const completedJob = await badgeJobModel.create({
        templateId: testTemplateId,
        uid: 'COMPLETED_001',
        badgeName: 'Completed Job'
      });
      await badgeJobModel.updateStatus(completedJob.id, 'completed');

      const response = await request(app)
        .post(`/api/jobs/${completedJob.id}/manual-intervention`)
        .send({ action: 'reset' })
        .expect(409);

      expect(response.body).toHaveProperty('error', 'Manual intervention not allowed');
    });

    it('should reject intervention on queued job', async () => {
      // Create queued job
      const queuedJob = await badgeJobModel.create({
        templateId: testTemplateId,
        uid: 'QUEUED_001',
        badgeName: 'Queued Job'
      });

      const response = await request(app)
        .post(`/api/jobs/${queuedJob.id}/manual-intervention`)
        .send({ action: 'reset' })
        .expect(409);

      expect(response.body).toHaveProperty('error', 'Manual intervention not allowed');
    });

    it('should return 404 for non-existent job', async () => {
      const response = await request(app)
        .post('/api/jobs/non-existent-id/manual-intervention')
        .send({ action: 'reset' })
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Job not found');
    });

    it('should handle missing action', async () => {
      const response = await request(app)
        .post(`/api/jobs/${processingJobId}/manual-intervention`)
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Invalid action');
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      // Temporarily remove database connection
      app.set('dbConnection', null);

      const response = await request(app)
        .get('/api/jobs/history')
        .expect(503);

      expect(response.body).toHaveProperty('error', 'Service unavailable');

      // Restore database connection
      app.set('dbConnection', dbConnection);
    });

    it('should handle queue manager unavailable', async () => {
      // Temporarily remove queue manager
      app.set('queueManager', null);

      const response = await request(app)
        .delete('/api/jobs/some-id')
        .expect(503);

      expect(response.body).toHaveProperty('error', 'Service unavailable');

      // Restore queue manager
      app.set('queueManager', queueManager);
    });

    it('should validate job ID format', async () => {
      // Create a job first to test with whitespace ID
      const job = await badgeJobModel.create({
        templateId: testTemplateId,
        uid: 'WHITESPACE_TEST',
        badgeName: 'Whitespace Test'
      });

      // Test with URL-encoded whitespace
      const response = await request(app)
        .delete('/api/jobs/%20%20%20')  // URL-encoded spaces
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Invalid job ID');
    });
  });

  describe('Integration Workflow Tests', () => {
    it('should handle complete job lifecycle with error recovery', async () => {
      // 1. Create job
      const job = await badgeJobModel.create({
        templateId: testTemplateId,
        uid: 'LIFECYCLE_001',
        badgeName: 'Lifecycle Test Job'
      });

      // 2. Simulate processing failure
      await badgeJobModel.updateStatus(job.id, 'processing');
      await badgeJobModel.updateStatus(job.id, 'failed', 'Simulated printer error');

      // 3. Retry the job
      const retryResponse = await request(app)
        .post(`/api/jobs/${job.id}/retry`)
        .expect(200);

      expect(retryResponse.body.job.status).toBe('queued');

      // 4. Simulate another failure requiring manual intervention
      await badgeJobModel.updateStatus(job.id, 'processing');
      await badgeJobModel.updateStatus(job.id, 'failed', 'Persistent error');

      // 5. Apply manual intervention to complete
      const interventionResponse = await request(app)
        .post(`/api/jobs/${job.id}/manual-intervention`)
        .send({ action: 'complete', reason: 'Manually printed and verified' })
        .expect(200);

      expect(interventionResponse.body.job.status).toBe('completed');

      // 6. Verify job appears in history
      const historyResponse = await request(app)
        .get('/api/jobs/history')
        .expect(200);

      const historyJob = historyResponse.body.jobs.find(j => j.id === job.id);
      expect(historyJob).toBeDefined();
      expect(historyJob.status).toBe('completed');
    });

    it('should handle concurrent job operations', async () => {
      // Create multiple jobs
      const jobs = [];
      for (let i = 0; i < 5; i++) {
        const job = await badgeJobModel.create({
          templateId: testTemplateId,
          uid: `CONCURRENT_${i.toString().padStart(3, '0')}`,
          badgeName: `Concurrent Job ${i + 1}`
        });
        jobs.push(job);
      }

      // Mark some as failed
      await badgeJobModel.updateStatus(jobs[0].id, 'failed', 'Error 1');
      await badgeJobModel.updateStatus(jobs[1].id, 'failed', 'Error 2');
      await badgeJobModel.updateStatus(jobs[2].id, 'processing');

      // Perform concurrent operations
      const operations = [
        request(app).post(`/api/jobs/${jobs[0].id}/retry`),
        request(app).delete(`/api/jobs/${jobs[3].id}`),
        request(app).post(`/api/jobs/${jobs[2].id}/manual-intervention`).send({ action: 'reset' }),
        request(app).get('/api/jobs/history')
      ];

      const results = await Promise.all(operations);

      // Verify all operations succeeded
      expect(results[0].status).toBe(200); // Retry
      expect(results[1].status).toBe(200); // Cancel
      expect(results[2].status).toBe(200); // Manual intervention
      expect(results[3].status).toBe(200); // History

      // Verify final states
      const retriedJob = await badgeJobModel.findById(jobs[0].id);
      expect(retriedJob.status).toBe('queued');

      const cancelledJob = await badgeJobModel.findById(jobs[3].id);
      expect(cancelledJob).toBeNull();

      const resetJob = await badgeJobModel.findById(jobs[2].id);
      expect(resetJob.status).toBe('queued');
    });
  });
});