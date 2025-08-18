const request = require('supertest');
const { app, server } = require('../server/index');
const Client = require('socket.io-client');

describe('Performance Optimization Tests', () => {
  let serverAddress;

  beforeAll(async () => {
    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const address = server.address();
    serverAddress = `http://localhost:${address.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  describe('Response Time Performance', () => {
    test('should load templates within 1 second', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const responseTime = Date.now() - startTime;
      
      expect(responseTime).toBeLessThan(1000);
      expect(response.body).toHaveProperty('templates');
      expect(Array.isArray(response.body.templates)).toBe(true);
      
      console.log(`Template loading time: ${responseTime}ms`);
    });

    test('should handle badge submission within 500ms', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const testTemplate = templatesResponse.body.templates[0];
      
      const startTime = Date.now();
      
      const response = await request(app)
        .post('/api/badges')
        .send({
          templateId: testTemplate.id,
          uid: `PERF-${Date.now()}`,
          badgeName: 'Performance Test Badge'
        })
        .expect(201);
      
      const responseTime = Date.now() - startTime;
      
      expect(responseTime).toBeLessThan(500);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('jobId');
      
      console.log(`Badge submission time: ${responseTime}ms`);
    });

    test('should return queue status within 2 seconds', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/api/queue')
        .expect(200);
      
      const responseTime = Date.now() - startTime;
      
      expect(responseTime).toBeLessThan(2000);
      expect(response.body).toHaveProperty('jobs');
      expect(response.body).toHaveProperty('queueLength');
      
      console.log(`Queue status time: ${responseTime}ms`);
    });

    test('should handle health check quickly', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      const responseTime = Date.now() - startTime;
      
      expect(responseTime).toBeLessThan(200);
      expect(response.body).toHaveProperty('status', 'ok');
      
      console.log(`Health check time: ${responseTime}ms`);
    });
  });

  describe('Throughput Performance', () => {
    test('should handle multiple rapid badge submissions', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const testTemplate = templatesResponse.body.templates[0];
      const numberOfJobs = 20;
      
      const startTime = Date.now();
      const promises = [];
      
      for (let i = 0; i < numberOfJobs; i++) {
        const badgeData = {
          templateId: testTemplate.id,
          uid: `THROUGHPUT-${i}-${Date.now()}`,
          badgeName: `Throughput Test Badge ${i}`
        };
        
        promises.push(
          request(app)
            .post('/api/badges')
            .send(badgeData)
            .expect(201)
        );
      }
      
      const results = await Promise.all(promises);
      const totalTime = Date.now() - startTime;
      const averageTime = totalTime / numberOfJobs;
      
      expect(results).toHaveLength(numberOfJobs);
      expect(averageTime).toBeLessThan(100); // Average should be under 100ms per job
      
      console.log(`Throughput test: ${numberOfJobs} jobs in ${totalTime}ms`);
      console.log(`Average time per job: ${averageTime}ms`);
      
      // Verify all jobs were created successfully
      results.forEach(result => {
        expect(result.body).toHaveProperty('success', true);
        expect(result.body).toHaveProperty('jobId');
      });
    }, 15000);

    test('should maintain performance under sustained load', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const testTemplate = templatesResponse.body.templates[0];
      const batchSize = 10;
      const numberOfBatches = 3;
      const batchTimes = [];
      
      for (let batch = 0; batch < numberOfBatches; batch++) {
        const batchStartTime = Date.now();
        const batchPromises = [];
        
        for (let i = 0; i < batchSize; i++) {
          const badgeData = {
            templateId: testTemplate.id,
            uid: `SUSTAINED-B${batch}-${i}-${Date.now()}`,
            badgeName: `Sustained Load Batch ${batch} Badge ${i}`
          };
          
          batchPromises.push(
            request(app)
              .post('/api/badges')
              .send(badgeData)
              .expect(201)
          );
        }
        
        await Promise.all(batchPromises);
        const batchTime = Date.now() - batchStartTime;
        batchTimes.push(batchTime);
        
        console.log(`Batch ${batch + 1} completed in ${batchTime}ms`);
        
        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Performance should not degrade significantly across batches
      const firstBatchTime = batchTimes[0];
      const lastBatchTime = batchTimes[batchTimes.length - 1];
      const degradationRatio = lastBatchTime / firstBatchTime;
      
      expect(degradationRatio).toBeLessThan(2.0); // Should not be more than 2x slower
      
      console.log(`Performance degradation ratio: ${degradationRatio.toFixed(2)}`);
    }, 30000);
  });

  describe('Memory and Resource Usage', () => {
    test('should maintain reasonable memory usage', async () => {
      const initialMemory = process.memoryUsage();
      
      // Perform memory-intensive operations
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const testTemplate = templatesResponse.body.templates[0];
      const numberOfJobs = 50;
      const promises = [];
      
      for (let i = 0; i < numberOfJobs; i++) {
        const badgeData = {
          templateId: testTemplate.id,
          uid: `MEMORY-${i}-${Date.now()}`,
          badgeName: `Memory Test Badge ${i}`
        };
        
        promises.push(
          request(app)
            .post('/api/badges')
            .send(badgeData)
            .expect(201)
        );
      }
      
      await Promise.all(promises);
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      const memoryIncreaseMB = memoryIncrease / (1024 * 1024);
      
      console.log(`Memory increase: ${memoryIncreaseMB.toFixed(2)} MB`);
      console.log(`Initial heap: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Final heap: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
      
      // Memory increase should be reasonable (less than 100MB for 50 jobs)
      expect(memoryIncreaseMB).toBeLessThan(100);
    }, 20000);

    test('should handle WebSocket connections efficiently', async () => {
      const numberOfConnections = 10;
      const clients = [];
      const connectionTimes = [];
      
      try {
        // Create multiple WebSocket connections and measure time
        for (let i = 0; i < numberOfConnections; i++) {
          const startTime = Date.now();
          const client = new Client(serverAddress);
          clients.push(client);
          
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error(`Connection ${i} timeout`));
            }, 5000);
            
            client.on('connect', () => {
              clearTimeout(timeout);
              const connectionTime = Date.now() - startTime;
              connectionTimes.push(connectionTime);
              resolve();
            });
            
            client.on('connect_error', (error) => {
              clearTimeout(timeout);
              reject(error);
            });
          });
        }
        
        const averageConnectionTime = connectionTimes.reduce((a, b) => a + b, 0) / connectionTimes.length;
        
        console.log(`Average WebSocket connection time: ${averageConnectionTime.toFixed(2)}ms`);
        expect(averageConnectionTime).toBeLessThan(1000);
        
        // Test concurrent queue status requests
        const statusPromises = clients.map((client, index) => {
          return new Promise((resolve) => {
            const startTime = Date.now();
            client.on('queueStatus', (data) => {
              const responseTime = Date.now() - startTime;
              resolve({ index, responseTime, data });
            });
            
            client.emit('requestQueueStatus');
          });
        });
        
        const statusResults = await Promise.all(statusPromises);
        const averageStatusTime = statusResults.reduce((sum, result) => sum + result.responseTime, 0) / statusResults.length;
        
        console.log(`Average WebSocket status response time: ${averageStatusTime.toFixed(2)}ms`);
        expect(averageStatusTime).toBeLessThan(500);
        
      } finally {
        // Clean up connections
        clients.forEach(client => {
          if (client && client.connected) {
            client.close();
          }
        });
      }
    }, 20000);
  });

  describe('Database Performance', () => {
    test('should handle database queries efficiently', async () => {
      // Test multiple concurrent queue status requests
      const numberOfRequests = 20;
      const promises = [];
      
      const startTime = Date.now();
      
      for (let i = 0; i < numberOfRequests; i++) {
        promises.push(
          request(app)
            .get('/api/queue')
            .expect(200)
        );
      }
      
      const results = await Promise.all(promises);
      const totalTime = Date.now() - startTime;
      const averageTime = totalTime / numberOfRequests;
      
      console.log(`Database query performance: ${numberOfRequests} requests in ${totalTime}ms`);
      console.log(`Average query time: ${averageTime.toFixed(2)}ms`);
      
      expect(averageTime).toBeLessThan(100);
      
      // Verify all requests succeeded
      results.forEach(result => {
        expect(result.body).toHaveProperty('jobs');
        expect(result.body).toHaveProperty('queueLength');
      });
    });

    test('should handle template queries efficiently', async () => {
      const numberOfRequests = 15;
      const promises = [];
      
      const startTime = Date.now();
      
      for (let i = 0; i < numberOfRequests; i++) {
        promises.push(
          request(app)
            .get('/api/templates')
            .expect(200)
        );
      }
      
      const results = await Promise.all(promises);
      const totalTime = Date.now() - startTime;
      const averageTime = totalTime / numberOfRequests;
      
      console.log(`Template query performance: ${numberOfRequests} requests in ${totalTime}ms`);
      console.log(`Average template query time: ${averageTime.toFixed(2)}ms`);
      
      expect(averageTime).toBeLessThan(200);
      
      // Verify all requests succeeded
      results.forEach(result => {
        expect(result.body).toHaveProperty('templates');
        expect(Array.isArray(result.body.templates)).toBe(true);
      });
    });
  });
});