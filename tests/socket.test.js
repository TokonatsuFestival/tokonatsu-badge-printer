const Client = require('socket.io-client');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

describe('Socket.io Server', () => {
  let clientSocket;
  let httpServer;
  let io;

  beforeAll((done) => {
    const app = express();
    httpServer = http.createServer(app);
    io = socketIo(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    // Socket.io connection handling (same as main server)
    io.on('connection', (socket) => {
      // Send initial connection confirmation
      socket.emit('connected', { 
        message: 'Connected to Festival Badge Printer',
        timestamp: new Date().toISOString()
      });
    });

    httpServer.listen(() => {
      const port = httpServer.address().port;
      clientSocket = new Client(`http://localhost:${port}`);
      clientSocket.on('connect', done);
    });
  });

  afterAll((done) => {
    if (clientSocket) {
      clientSocket.close();
    }
    if (io) {
      io.close();
    }
    if (httpServer) {
      httpServer.close(done);
    } else {
      done();
    }
  });

  test('should connect and receive welcome message', (done) => {
    // Create a new client for this test to ensure clean state
    const testClient = new Client(`http://localhost:${httpServer.address().port}`);
    
    testClient.on('connected', (data) => {
      expect(data).toHaveProperty('message', 'Connected to Festival Badge Printer');
      expect(data).toHaveProperty('timestamp');
      testClient.close();
      done();
    });
  });

  test('should handle multiple connections', (done) => {
    const client1 = new Client(`http://localhost:${httpServer.address().port}`);
    const client2 = new Client(`http://localhost:${httpServer.address().port}`);
    
    let connectCount = 0;
    
    const handleConnect = () => {
      connectCount++;
      if (connectCount === 2) {
        client1.close();
        client2.close();
        done();
      }
    };
    
    client1.on('connected', handleConnect);
    client2.on('connected', handleConnect);
  });
});