const request = require('supertest');
const { app, server } = require('../server/index');
const Client = require('socket.io-client');

describe('Concurrent Users and Queue Management Tests', () => {
  let serverAddress;
  let socketClients = [];

  beforeAll(async () => {
    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const address = server.address();
    serverAddress = `http://localhost:${address.port}`;
  });

  afterAll(async () => {
    // Close all socket connections
    socketClients.forEach(client => {
      if (client && client.connected) {
        client.close();
      }
    });
    
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  describe('Multiple Concurrent Users', () => {
    test('should support 5 simultaneous users submitting badges', async () => {
      // Get available templates
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const testTemplate = templatesResponse.body.templates[0];
      const numberOfUsers = 5;
      const badgesPerUser = 3;
      
      // Create concurrent badge submissions
      const userPromises = [];
      
      for (let user = 0; user < numberOfUsers; user++) {
        const userBadgePromises = [];
        
        for (let badge = 0; badge < badgesPerUser; badge++) {
          const badgeData = {
            templateId: testTemplate.id,
            uid: `USER${user}-BADGE${badge}-${Date.now()}`,
            badgeName: `User ${user} Badge ${badge}`
          };
          
          userBadgePromises.push(
            request(app)
              .post('/api/badges')
              .send(badgeData)
              .expect(201)
          );
        }
        
        userPromises.push(Promise.all(userBadgePromises));
      }
      
      // Execute all submissions concurrently
      const startTime = Date.now();
      const results = await Promise.all(userPromises);
      const totalTime = Date.now() - startTime;
      
      // Verify all submissions succeeded
      expect(results).toHaveLength(numberOfUsers);
      results.forEach(userResults => {
        expect(userResults).toHaveLength(badgesPerUser);
        userResults.forEach(response => {
          expect(response.body).toHaveProperty('success', true);
          expect(response.body).toHaveProperty('jobId');
        });
      });
      
      // Verify queue contains all jobs
      const queueResponse = await request(app)
        .get('/api/queue')
        .expect(200);
      
      const totalExpectedJobs = numberOfUsers * badgesPerUser;
      expect(queueResponse.body.queueLength).toBeGreaterThanOrEqual(totalExpectedJobs);
      
      console.log(`Concurrent submission test completed in ${totalTime}ms`);
      console.log(`Total jobs submitted: ${totalExpectedJobs}`);
      console.log(`Current queue length: ${queueResponse.body.queueLength}`);
    }, 30000);

    test('should handle concurrent WebSocket connections', async () => {
      const numberOfClients = 5;
      const connectionPromises = [];
      
      // Create multiple WebSocket connections
      for (let i = 0; i < numberOfClients; i++) {
        const client = new Client(serverAddress);
        socketClients.push(client);
        
        connectionPromises.push(
          new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error(`Client ${i} connection timeout`));
            }, 5000);
            
            client.on('connect', () => {
              clearTimeout(timeout);
              resolve(client);
            });
            
            client.on('connect_error', (error) => {
              clearTimeout(timeout);
              reject(error);
            });
          })
        );
      }
      
      // Wait for all connections
      const connectedClients = await Promise.all(connectionPromises);
      expect(connectedClients).toHaveLength(numberOfClients);
      
      // Test concurrent queue status requests
      const statusPromises = connectedClients.map((client, index) => {
        return new Promise((resolve) => {
          client.on('queueStatus', (data) => {
            resolve({ clientIndex: index, data });
          });
          
          client.emit('requestQueueStatus');
        });
      });
      
      const statusResults = await Promise.all(statusPromises);
      expect(statusResults).toHaveLength(numberOfClients);
      
      statusResults.forEach(result => {
        expect(result.data).toHaveProperty('jobs');
        expect(result.data).toHaveProperty('queueLength');
      });
    }, 15000);

    test('should maintain queue integrity under concurrent load', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const testTemplate = templatesResponse.body.templates[0];
      
      // Get initial queue state
      const initialQueueResponse = await request(app)
        .get('/api/queue')
        .expect(200);
      
      const initialQueueLength = initialQueueResponse.body.queueLength;
      
      // Submit multiple jobs concurrently
      const concurrentJobs = 10;
      const jobPromises = [];
      
      for (let i = 0; i < concurrentJobs; i++) {
        const badgeData = {
          templateId: testTemplate.id,
          uid: `CONCURRENT-${i}-${Date.now()}`,
          badgeName: `Concurrent Badge ${i}`
        };
        
        jobPromises.push(
          request(app)
            .post('/api/badges')
            .send(badgeData)
            .expect(201)
        );
      }
      
      const results = await Promise.all(jobPromises);
      
      // Verify all jobs were submitted successfully
      expect(results).toHaveLength(concurrentJobs);
      
      const jobIds = results.map(result => result.body.jobId);
      expect(new Set(jobIds).size).toBe(concurrentJobs); // All job IDs should be unique
      
      // Verify queue state
      const finalQueueResponse = await request(app)
        .get('/api/queue')
        .expect(200);
      
      expect(finalQueueResponse.body.queueLength).toBe(initialQueueLength + concurrentJobs);
      
      // Verify all submitted jobs are in the queue
      const queueJobIds = finalQueueResponse.body.jobs.map(job => job.id);
      jobIds.forEach(jobId => {
        expect(queueJobIds).toContain(jobId);
      });
    });
  });

  describe('Queue Management Under Load', () => {
    test('should handle queue capacity limits', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const testTemplate = templatesResponse.body.templates[0];
      
      // Try to fill queue beyond capacity (assuming max 50 jobs)
      const maxJobs = 55; // Attempt to exceed capacity
      const jobPromises = [];
      
      for (let i = 0; i < maxJobs; i++) {
        const badgeData = {
          templateId: testTemplate.id,
          uid: `CAPACITY-${i}-${Date.now()}`,
          badgeName: `Capacity Test Badge ${i}`
        };
        
        jobPromises.push(
          request(app)
            .post('/api/badges')
            .send(badgeData)
        );
      }
      
      const results = await Promise.allSettled(jobPromises);
      
      // Some requests should succeed, some might be rejected due to capacity
      const successful = results.filter(result => 
        result.status === 'fulfilled' && result.value.status === 201
      );
      const rejected = results.filter(result => 
        result.status === 'fulfilled' && result.value.status !== 201
      );
      
      console.log(`Successful submissions: ${successful.length}`);
      console.log(`Rejected submissions: ${rejected.length}`);
      
      // Should have some successful submissions
      expect(successful.length).toBeGreaterThan(0);
      
      // Verify queue doesn't exceed maximum capacity
      const queueResponse = await request(app)
        .get('/api/queue')
        .expect(200);
      
      expect(queueResponse.body.queueLength).toBeLessThanOrEqual(50);
    }, 30000);

    test('should process jobs in FIFO order', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const testTemplate = templatesResponse.body.templates[0];
      
      // Clear queue first by waiting for processing
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Submit jobs in sequence with timestamps
      const jobCount = 5;
      const submittedJobs = [];
      
      for (let i = 0; i < jobCount; i++) {
        const badgeData = {
          templateId: testTemplate.id,
          uid: `FIFO-${i}-${Date.now()}`,
          badgeName: `FIFO Test Badge ${i}`
        };
        
        const response = await request(app)
          .post('/api/badges')
          .send(badgeData)
          .expect(201);
        
        submittedJobs.push({
          jobId: response.body.jobId,
          submissionOrder: i,
          submissionTime: Date.now()
        });
        
        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Monitor job processing order
      let processedJobs = [];
      let attempts = 0;
      const maxAttempts = 60; // 60 seconds timeout
      
      while (processedJobs.length < jobCount && attempts < maxAttempts) {
        const queueResponse = await request(app)
          .get('/api/queue')
          .expect(200);
        
        // Check for completed jobs
        const completedInThisCheck = queueResponse.body.jobs
          .filter(job => 
            job.status === 'completed' && 
            submittedJobs.some(sj => sj.jobId === job.id) &&
            !processedJobs.some(pj => pj.jobId === job.id)
          );
        
        completedInThisCheck.forEach(job => {
          const originalJob = submittedJobs.find(sj => sj.jobId === job.id);
          processedJobs.push({
            jobId: job.id,
            submissionOrder: originalJob.submissionOrder,
            processedAt: job.processedAt
          });
        });
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      }
      
      // Verify FIFO processing order
      if (processedJobs.length >= 2) {
        processedJobs.sort((a, b) => new Date(a.processedAt) - new Date(b.processedAt));
        
        for (let i = 1; i < processedJobs.length; i++) {
          expect(processedJobs[i].submissionOrder).toBeGreaterThanOrEqual(
            processedJobs[i - 1].submissionOrder
          );
        }
      }
    }, 90000);
  });
});