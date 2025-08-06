const request = require('supertest');
const { app, server } = require('../server/index');

describe('Express Server', () => {
  afterAll((done) => {
    server.close(done);
  });

  describe('Middleware', () => {
    test('should parse JSON requests', async () => {
      const response = await request(app)
        .post('/api/badges')
        .send({ test: 'data' })
        .expect(501);
      
      expect(response.body).toHaveProperty('message');
      expect(response.body.endpoint).toBe('POST /api/badges');
    });

    test('should serve static files', async () => {
      await request(app)
        .get('/')
        .expect(200);
    });

    test('should handle 404 for API routes', async () => {
      const response = await request(app)
        .get('/api/nonexistent')
        .expect(404);
      
      expect(response.body).toHaveProperty('error', 'API endpoint not found');
      expect(response.body).toHaveProperty('path', '/api/nonexistent');
      expect(response.body).toHaveProperty('method', 'GET');
    });
  });

  describe('Health Check', () => {
    test('should return server status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
    });
  });

  describe('API Routes', () => {
    test('GET /api/templates should return placeholder', async () => {
      const response = await request(app)
        .get('/api/templates')
        .expect(501);
      
      expect(response.body.message).toBe('Template listing not yet implemented');
    });

    test('GET /api/queue should return placeholder', async () => {
      const response = await request(app)
        .get('/api/queue')
        .expect(501);
      
      expect(response.body.message).toBe('Queue status retrieval not yet implemented');
    });

    test('POST /api/badges should return placeholder', async () => {
      const response = await request(app)
        .post('/api/badges')
        .send({ uid: 'test', badgeName: 'Test Badge' })
        .expect(501);
      
      expect(response.body.message).toBe('Badge job submission not yet implemented');
    });

    test('GET /api/printers should return placeholder', async () => {
      const response = await request(app)
        .get('/api/printers')
        .expect(501);
      
      expect(response.body.message).toBe('Printer discovery not yet implemented');
    });

    test('DELETE /api/queue/:id should return placeholder', async () => {
      const response = await request(app)
        .delete('/api/queue/test-id')
        .expect(501);
      
      expect(response.body.message).toBe('Job cancellation not yet implemented');
    });
  });
});