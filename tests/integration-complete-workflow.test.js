const request = require('supertest');
const { app, server, io } = require('../server/index');
const Client = require('socket.io-client');
const path = require('path');
const fs = require('fs').promises;

describe('Complete Workflow Integration Tests', () => {
  let clientSocket;
  let serverAddress;

  beforeAll(async () => {
    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const address = server.address();
    serverAddress = `http://localhost:${address.port}`;
    
    // Connect socket client
    clientSocket = new Client(serverAddress);
    await new Promise(resolve => {
      clientSocket.on('connect', resolve);
    });
  });

  afterAll(async () => {
    if (clientSocket) {
      clientSocket.close();
    }
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  describe('End-to-End Badge Creation Workflow', () => {
    test('should complete full badge creation to print workflow', async () => {
      // Step 1: Get available templates
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      expect(templatesResponse.body).toHaveProperty('templates');
      expect(Array.isArray(templatesResponse.body.templates)).toBe(true);
      
      const templates = templatesResponse.body.templates;
      expect(templates.length).toBeGreaterThan(0);
      
      const testTemplate = templates[0];
      expect(testTemplate).toHaveProperty('id');
      expect(testTemplate).toHaveProperty('name');

      // Step 2: Check initial queue status
      const initialQueueResponse = await request(app)
        .get('/api/queue')
        .expect(200);
      
      expect(initialQueueResponse.body).toHaveProperty('jobs');
      expect(initialQueueResponse.body).toHaveProperty('queueLength');
      
      const initialQueueLength = initialQueueResponse.body.queueLength;

      // Step 3: Submit badge job
      const badgeData = {
        templateId: testTemplate.id,
        uid: `TEST-${Date.now()}`,
        badgeName: 'Integration Test Badge'
      };

      const submitResponse = await request(app)
        .post('/api/badges')
        .send(badgeData)
        .expect(201);
      
      expect(submitResponse.body).toHaveProperty('success', true);
      expect(submitResponse.body).toHaveProperty('jobId');
      expect(submitResponse.body).toHaveProperty('message');
      
      const jobId = submitResponse.body.jobId;

      // Step 4: Verify job was added to queue
      const updatedQueueResponse = await request(app)
        .get('/api/queue')
        .expect(200);
      
      expect(updatedQueueResponse.body.queueLength).toBe(initialQueueLength + 1);
      
      const addedJob = updatedQueueResponse.body.jobs.find(job => job.id === jobId);
      expect(addedJob).toBeDefined();
      expect(addedJob.templateId).toBe(badgeData.templateId);
      expect(addedJob.uid).toBe(badgeData.uid);
      expect(addedJob.badgeName).toBe(badgeData.badgeName);
      expect(['queued', 'processing'].includes(addedJob.status)).toBe(true);

      // Step 5: Wait for job processing and monitor status changes
      let jobCompleted = false;
      let attempts = 0;
      const maxAttempts = 30; // 30 seconds timeout
      
      while (!jobCompleted && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const statusResponse = await request(app)
          .get('/api/queue')
          .expect(200);
        
        const currentJob = statusResponse.body.jobs.find(job => job.id === jobId);
        
        if (!currentJob || currentJob.status === 'completed' || currentJob.status === 'failed') {
          jobCompleted = true;
          
          if (currentJob && currentJob.status === 'completed') {
            expect(currentJob.processedAt).toBeDefined();
            expect(new Date(currentJob.processedAt)).toBeInstanceOf(Date);
          }
        }
        
        attempts++;
      }
      
      expect(jobCompleted).toBe(true);

      // Step 6: Verify final queue state
      const finalQueueResponse = await request(app)
        .get('/api/queue')
        .expect(200);
      
      // Job should either be completed (and possibly removed) or failed
      const finalJob = finalQueueResponse.body.jobs.find(job => job.id === jobId);
      if (finalJob) {
        expect(['completed', 'failed'].includes(finalJob.status)).toBe(true);
      }
    }, 60000); // 60 second timeout for full workflow

    test('should handle duplicate UID validation', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const testTemplate = templatesResponse.body.templates[0];
      const duplicateUID = `DUPLICATE-${Date.now()}`;

      // Submit first job
      const firstJobResponse = await request(app)
        .post('/api/badges')
        .send({
          templateId: testTemplate.id,
          uid: duplicateUID,
          badgeName: 'First Badge'
        })
        .expect(201);

      // Attempt to submit duplicate UID
      const duplicateResponse = await request(app)
        .post('/api/badges')
        .send({
          templateId: testTemplate.id,
          uid: duplicateUID,
          badgeName: 'Duplicate Badge'
        })
        .expect(400);

      expect(duplicateResponse.body).toHaveProperty('error');
      expect(duplicateResponse.body.error).toContain('UID already exists');
    });

    test('should validate required fields', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const testTemplate = templatesResponse.body.templates[0];

      // Test missing UID
      await request(app)
        .post('/api/badges')
        .send({
          templateId: testTemplate.id,
          badgeName: 'Test Badge'
        })
        .expect(400);

      // Test missing badge name
      await request(app)
        .post('/api/badges')
        .send({
          templateId: testTemplate.id,
          uid: `TEST-${Date.now()}`
        })
        .expect(400);

      // Test missing template ID
      await request(app)
        .post('/api/badges')
        .send({
          uid: `TEST-${Date.now()}`,
          badgeName: 'Test Badge'
        })
        .expect(400);
    });
  });

  describe('Real-time Updates', () => {
    test('should receive real-time queue updates via WebSocket', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const testTemplate = templatesResponse.body.templates[0];
      
      // Set up WebSocket listener
      const queueUpdates = [];
      clientSocket.on('queueStatus', (data) => {
        queueUpdates.push(data);
      });

      // Request initial queue status
      clientSocket.emit('requestQueueStatus');
      
      // Wait for initial status
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(queueUpdates.length).toBeGreaterThan(0);
      
      const initialUpdate = queueUpdates[queueUpdates.length - 1];
      expect(initialUpdate).toHaveProperty('jobs');
      expect(initialUpdate).toHaveProperty('queueLength');

      // Submit a new job
      const badgeData = {
        templateId: testTemplate.id,
        uid: `REALTIME-${Date.now()}`,
        badgeName: 'Real-time Test Badge'
      };

      await request(app)
        .post('/api/badges')
        .send(badgeData)
        .expect(201);

      // Wait for queue update
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Should have received updated queue status
      expect(queueUpdates.length).toBeGreaterThan(1);
    });

    test('should handle WebSocket connection errors gracefully', async () => {
      const errorSocket = new Client(serverAddress, {
        timeout: 1000
      });

      let connectionError = false;
      errorSocket.on('connect_error', () => {
        connectionError = true;
      });

      // Force connection error by connecting to wrong port
      const badSocket = new Client('http://localhost:9999');
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      badSocket.close();
      errorSocket.close();
    });
  });

  describe('Performance Validation', () => {
    test('should handle response times within acceptable limits', async () => {
      const startTime = Date.now();
      
      await request(app)
        .get('/api/templates')
        .expect(200);
      
      const templateLoadTime = Date.now() - startTime;
      expect(templateLoadTime).toBeLessThan(1000); // < 1 second

      const queueStartTime = Date.now();
      
      await request(app)
        .get('/api/queue')
        .expect(200);
      
      const queueLoadTime = Date.now() - queueStartTime;
      expect(queueLoadTime).toBeLessThan(2000); // < 2 seconds
    });

    test('should handle badge submission within acceptable time', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const testTemplate = templatesResponse.body.templates[0];
      
      const startTime = Date.now();
      
      await request(app)
        .post('/api/badges')
        .send({
          templateId: testTemplate.id,
          uid: `PERF-${Date.now()}`,
          badgeName: 'Performance Test Badge'
        })
        .expect(201);
      
      const submissionTime = Date.now() - startTime;
      expect(submissionTime).toBeLessThan(500); // < 500ms
    });
  });
});