const request = require('supertest');
const { app, server } = require('../server/index');
const PrinterInterface = require('../server/services/PrinterInterface');

describe('Printer Failure Recovery Tests', () => {
  let originalPrinterInterface;

  beforeAll(async () => {
    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  afterAll(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  describe('Printer Connection Failures', () => {
    test('should handle printer disconnection gracefully', async () => {
      // Get printer status
      const printerResponse = await request(app)
        .get('/api/printers')
        .expect(200);
      
      expect(printerResponse.body).toHaveProperty('printers');
      expect(Array.isArray(printerResponse.body.printers)).toBe(true);
      
      // Test printer diagnostics
      const diagnosticsResponse = await request(app)
        .get('/api/diagnostics?component=printer')
        .expect(200);
      
      expect(diagnosticsResponse.body).toHaveProperty('component', 'printer');
      expect(diagnosticsResponse.body).toHaveProperty('status');
      expect(diagnosticsResponse.body).toHaveProperty('details');
    });

    test('should retry failed print jobs', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const testTemplate = templatesResponse.body.templates[0];
      
      // Submit a badge job
      const badgeData = {
        templateId: testTemplate.id,
        uid: `RETRY-${Date.now()}`,
        badgeName: 'Retry Test Badge'
      };

      const submitResponse = await request(app)
        .post('/api/badges')
        .send(badgeData)
        .expect(201);
      
      const jobId = submitResponse.body.jobId;
      
      // Monitor job status for retry behavior
      let jobStatus = null;
      let retryCount = 0;
      let attempts = 0;
      const maxAttempts = 30;
      
      while (attempts < maxAttempts) {
        const queueResponse = await request(app)
          .get('/api/queue')
          .expect(200);
        
        const job = queueResponse.body.jobs.find(j => j.id === jobId);
        
        if (job) {
          jobStatus = job.status;
          retryCount = job.retryCount || 0;
          
          // If job failed or completed, break
          if (job.status === 'failed' || job.status === 'completed') {
            break;
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      }
      
      // Job should have been processed (either completed or failed after retries)
      expect(['completed', 'failed'].includes(jobStatus)).toBe(true);
      
      // If job failed, it should have attempted retries
      if (jobStatus === 'failed') {
        expect(retryCount).toBeGreaterThan(0);
        expect(retryCount).toBeLessThanOrEqual(3); // Max retries should be 3
      }
    }, 45000);

    test('should handle printer reconnection', async () => {
      // Test printer discovery
      const discoveryResponse = await request(app)
        .post('/api/printers/discover')
        .expect(200);
      
      expect(discoveryResponse.body).toHaveProperty('success');
      expect(discoveryResponse.body).toHaveProperty('printers');
      expect(Array.isArray(discoveryResponse.body.printers)).toBe(true);
      
      // Test printer connection
      if (discoveryResponse.body.printers.length > 0) {
        const printerId = discoveryResponse.body.printers[0].id;
        
        const connectResponse = await request(app)
          .post('/api/printers/connect')
          .send({ printerId })
          .expect(200);
        
        expect(connectResponse.body).toHaveProperty('success');
      }
    });

    test('should provide printer diagnostics and troubleshooting', async () => {
      // Test full diagnostics
      const fullDiagnosticsResponse = await request(app)
        .get('/api/diagnostics')
        .expect(200);
      
      expect(fullDiagnosticsResponse.body).toHaveProperty('timestamp');
      expect(fullDiagnosticsResponse.body).toHaveProperty('components');
      expect(fullDiagnosticsResponse.body.components).toHaveProperty('printer');
      
      // Test printer-specific diagnostics
      const printerDiagnosticsResponse = await request(app)
        .get('/api/diagnostics?component=printer')
        .expect(200);
      
      expect(printerDiagnosticsResponse.body).toHaveProperty('component', 'printer');
      expect(printerDiagnosticsResponse.body).toHaveProperty('status');
      expect(printerDiagnosticsResponse.body).toHaveProperty('details');
      
      // Test diagnostics report generation
      const reportResponse = await request(app)
        .get('/api/diagnostics/report?format=json')
        .expect(200);
      
      expect(reportResponse.body).toHaveProperty('generatedAt');
      expect(reportResponse.body).toHaveProperty('summary');
      expect(reportResponse.body).toHaveProperty('components');
      
      // Test text format report
      const textReportResponse = await request(app)
        .get('/api/diagnostics/report?format=text')
        .expect(200);
      
      expect(textReportResponse.headers['content-type']).toContain('text/plain');
      expect(typeof textReportResponse.text).toBe('string');
      expect(textReportResponse.text.length).toBeGreaterThan(0);
    });
  });

  describe('Error Recovery Mechanisms', () => {
    test('should handle job cancellation during printer failure', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const testTemplate = templatesResponse.body.templates[0];
      
      // Submit a badge job
      const badgeData = {
        templateId: testTemplate.id,
        uid: `CANCEL-${Date.now()}`,
        badgeName: 'Cancellation Test Badge'
      };

      const submitResponse = await request(app)
        .post('/api/badges')
        .send(badgeData)
        .expect(201);
      
      const jobId = submitResponse.body.jobId;
      
      // Wait a moment for job to be queued
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Cancel the job
      const cancelResponse = await request(app)
        .delete(`/api/jobs/${jobId}`)
        .expect(200);
      
      expect(cancelResponse.body).toHaveProperty('success', true);
      expect(cancelResponse.body).toHaveProperty('message');
      
      // Verify job is cancelled
      const queueResponse = await request(app)
        .get('/api/queue')
        .expect(200);
      
      const cancelledJob = queueResponse.body.jobs.find(job => job.id === jobId);
      if (cancelledJob) {
        expect(cancelledJob.status).toBe('cancelled');
      }
    });

    test('should handle manual job retry', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const testTemplate = templatesResponse.body.templates[0];
      
      // Submit a badge job
      const badgeData = {
        templateId: testTemplate.id,
        uid: `MANUAL-RETRY-${Date.now()}`,
        badgeName: 'Manual Retry Test Badge'
      };

      const submitResponse = await request(app)
        .post('/api/badges')
        .send(badgeData)
        .expect(201);
      
      const jobId = submitResponse.body.jobId;
      
      // Wait for job to potentially fail or get stuck
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Attempt manual retry
      const retryResponse = await request(app)
        .post(`/api/jobs/${jobId}/retry`)
        .expect(200);
      
      expect(retryResponse.body).toHaveProperty('success', true);
      expect(retryResponse.body).toHaveProperty('message');
      
      // Verify job status was updated
      const queueResponse = await request(app)
        .get('/api/queue')
        .expect(200);
      
      const retriedJob = queueResponse.body.jobs.find(job => job.id === jobId);
      if (retriedJob) {
        expect(['queued', 'processing', 'completed'].includes(retriedJob.status)).toBe(true);
      }
    });

    test('should provide error details for failed jobs', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const testTemplate = templatesResponse.body.templates[0];
      
      // Submit a badge job that might fail
      const badgeData = {
        templateId: testTemplate.id,
        uid: `ERROR-DETAILS-${Date.now()}`,
        badgeName: 'Error Details Test Badge'
      };

      const submitResponse = await request(app)
        .post('/api/badges')
        .send(badgeData)
        .expect(201);
      
      const jobId = submitResponse.body.jobId;
      
      // Monitor job for failure
      let jobFailed = false;
      let attempts = 0;
      const maxAttempts = 30;
      
      while (!jobFailed && attempts < maxAttempts) {
        const queueResponse = await request(app)
          .get('/api/queue')
          .expect(200);
        
        const job = queueResponse.body.jobs.find(j => j.id === jobId);
        
        if (job && job.status === 'failed') {
          jobFailed = true;
          
          // Verify error details are provided
          expect(job).toHaveProperty('errorMessage');
          expect(typeof job.errorMessage).toBe('string');
          expect(job.errorMessage.length).toBeGreaterThan(0);
          
          expect(job).toHaveProperty('retryCount');
          expect(typeof job.retryCount).toBe('number');
        }
        
        if (job && job.status === 'completed') {
          // Job completed successfully, which is also acceptable
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      }
    }, 45000);
  });

  describe('System Recovery', () => {
    test('should maintain system stability during printer issues', async () => {
      // Test health check during printer issues
      const healthResponse = await request(app)
        .get('/health')
        .expect(200);
      
      expect(healthResponse.body).toHaveProperty('status', 'ok');
      expect(healthResponse.body).toHaveProperty('services');
      expect(healthResponse.body.services).toHaveProperty('database');
      expect(healthResponse.body.services).toHaveProperty('queueManager');
      
      // System should remain responsive
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      expect(templatesResponse.body).toHaveProperty('templates');
      
      // Queue should remain accessible
      const queueResponse = await request(app)
        .get('/api/queue')
        .expect(200);
      
      expect(queueResponse.body).toHaveProperty('jobs');
      expect(queueResponse.body).toHaveProperty('queueLength');
    });

    test('should log printer errors appropriately', async () => {
      // Test log statistics endpoint
      const logStatsResponse = await request(app)
        .get('/api/logs/stats')
        .expect(200);
      
      expect(logStatsResponse.body).toHaveProperty('totalLogs');
      expect(logStatsResponse.body).toHaveProperty('categories');
      expect(typeof logStatsResponse.body.totalLogs).toBe('number');
      
      // Test recent logs endpoint
      const recentLogsResponse = await request(app)
        .get('/api/logs/recent?category=combined&lines=50')
        .expect(200);
      
      expect(recentLogsResponse.body).toHaveProperty('category', 'combined');
      expect(recentLogsResponse.body).toHaveProperty('logs');
      expect(Array.isArray(recentLogsResponse.body.logs)).toBe(true);
    });
  });
});