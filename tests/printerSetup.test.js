const request = require('supertest');
const express = require('express');
const PrinterInterface = require('../server/services/PrinterInterface');
const printerRoutes = require('../server/routes/printers');

// Mock the PrinterInterface
jest.mock('../server/services/PrinterInterface');

describe('Printer Setup and Configuration', () => {
  let app;
  let mockPrinterInterface;

  beforeEach(() => {
    // Create Express app for testing
    app = express();
    app.use(express.json());
    
    // Create mock printer interface
    mockPrinterInterface = {
      discoverPrinters: jest.fn(),
      getPrinterStatus: jest.fn(),
      connectToPrinter: jest.fn(),
      disconnect: jest.fn(),
      getAvailablePresets: jest.fn()
    };
    
    // Set up app with mock printer interface
    app.set('printerInterface', mockPrinterInterface);
    app.use('/api/printers', printerRoutes);
    
    // Error handling middleware
    app.use((error, req, res, next) => {
      res.status(500).json({
        success: false,
        message: error.message
      });
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Printer Discovery', () => {
    test('should discover available printers successfully', async () => {
      const mockPrinters = [
        {
          id: 'printer-1',
          name: 'HP LaserJet Pro',
          isConnected: true,
          status: 'Ready',
          type: 'USB',
          platform: 'darwin'
        },
        {
          id: 'printer-2',
          name: 'Canon PIXMA',
          isConnected: false,
          status: 'Offline',
          type: 'USB',
          platform: 'darwin'
        }
      ];

      mockPrinterInterface.discoverPrinters.mockResolvedValue(mockPrinters);

      const response = await request(app)
        .get('/api/printers')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        printers: mockPrinters,
        count: 2
      });

      expect(mockPrinterInterface.discoverPrinters).toHaveBeenCalledTimes(1);
    });

    test('should handle printer discovery errors', async () => {
      const errorMessage = 'Failed to discover printers';
      mockPrinterInterface.discoverPrinters.mockRejectedValue(new Error(errorMessage));

      const response = await request(app)
        .get('/api/printers')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        message: 'Failed to discover printers',
        error: errorMessage
      });
    });

    test('should return empty list when no printers found', async () => {
      mockPrinterInterface.discoverPrinters.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/printers')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        printers: [],
        count: 0
      });
    });
  });

  describe('Printer Status', () => {
    test('should get current printer status successfully', async () => {
      const mockStatus = {
        isConnected: true,
        status: 'Ready',
        printerId: 'printer-1',
        printerName: 'HP LaserJet Pro'
      };

      mockPrinterInterface.getPrinterStatus.mockResolvedValue(mockStatus);

      const response = await request(app)
        .get('/api/printers/status')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        status: mockStatus
      });

      expect(mockPrinterInterface.getPrinterStatus).toHaveBeenCalledTimes(1);
    });

    test('should handle printer status errors', async () => {
      const errorMessage = 'No printer selected';
      mockPrinterInterface.getPrinterStatus.mockRejectedValue(new Error(errorMessage));

      const response = await request(app)
        .get('/api/printers/status')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        message: 'Failed to get printer status',
        error: errorMessage
      });
    });

    test('should return disconnected status when no printer selected', async () => {
      const mockStatus = {
        isConnected: false,
        status: 'No printer selected',
        printerId: null
      };

      mockPrinterInterface.getPrinterStatus.mockResolvedValue(mockStatus);

      const response = await request(app)
        .get('/api/printers/status')
        .expect(200);

      expect(response.body.status.isConnected).toBe(false);
    });
  });

  describe('Printer Connection', () => {
    test('should connect to printer successfully', async () => {
      const printerId = 'printer-1';
      mockPrinterInterface.connectToPrinter.mockResolvedValue(true);

      const response = await request(app)
        .post(`/api/printers/${printerId}/connect`)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: `Connected to printer: ${printerId}`,
        printerId: printerId
      });

      expect(mockPrinterInterface.connectToPrinter).toHaveBeenCalledWith(printerId);
    });

    test('should handle connection failures', async () => {
      const printerId = 'printer-1';
      const errorMessage = 'Printer not available';
      mockPrinterInterface.connectToPrinter.mockRejectedValue(new Error(errorMessage));

      const response = await request(app)
        .post(`/api/printers/${printerId}/connect`)
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        message: 'Failed to connect to printer',
        error: errorMessage
      });
    });

    test('should handle connection returning false', async () => {
      const printerId = 'printer-1';
      mockPrinterInterface.connectToPrinter.mockResolvedValue(false);

      const response = await request(app)
        .post(`/api/printers/${printerId}/connect`)
        .expect(400);

      expect(response.body).toEqual({
        success: false,
        message: `Failed to connect to printer: ${printerId}`
      });
    });
  });

  describe('Printer Disconnection', () => {
    test('should disconnect from printer successfully', async () => {
      mockPrinterInterface.disconnect.mockReturnValue(undefined);

      const response = await request(app)
        .post('/api/printers/disconnect')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Disconnected from printer'
      });

      expect(mockPrinterInterface.disconnect).toHaveBeenCalledTimes(1);
    });

    test('should handle disconnection errors', async () => {
      const errorMessage = 'Disconnection failed';
      mockPrinterInterface.disconnect.mockImplementation(() => {
        throw new Error(errorMessage);
      });

      const response = await request(app)
        .post('/api/printers/disconnect')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        message: 'Failed to disconnect from printer',
        error: errorMessage
      });
    });
  });

  describe('Printer Presets', () => {
    test('should get available presets successfully', async () => {
      const mockPresets = [
        {
          name: 'default',
          description: 'Standard badge printing settings',
          options: {
            paperSize: 'A4',
            orientation: 'portrait',
            scale: 'fit',
            copies: 1
          }
        },
        {
          name: 'high-quality',
          description: 'High quality badge printing',
          options: {
            paperSize: 'A4',
            orientation: 'portrait',
            scale: 'fit',
            copies: 1,
            quality: 'high'
          }
        }
      ];

      mockPrinterInterface.getAvailablePresets.mockReturnValue(mockPresets);

      const response = await request(app)
        .get('/api/printers/presets')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        presets: mockPresets
      });

      expect(mockPrinterInterface.getAvailablePresets).toHaveBeenCalledTimes(1);
    });

    test('should handle preset loading errors', async () => {
      const errorMessage = 'Failed to load presets';
      mockPrinterInterface.getAvailablePresets.mockImplementation(() => {
        throw new Error(errorMessage);
      });

      const response = await request(app)
        .get('/api/printers/presets')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        message: 'Failed to get printer presets',
        error: errorMessage
      });
    });

    test('should return empty presets list', async () => {
      mockPrinterInterface.getAvailablePresets.mockReturnValue([]);

      const response = await request(app)
        .get('/api/printers/presets')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        presets: []
      });
    });
  });

  describe('Printer Connectivity Testing', () => {
    test('should test printer connectivity successfully', async () => {
      const mockStatus = {
        isConnected: true,
        status: 'Ready',
        printerId: 'printer-1',
        printerName: 'HP LaserJet Pro'
      };

      mockPrinterInterface.getPrinterStatus.mockResolvedValue(mockStatus);

      const response = await request(app)
        .post('/api/printers/test')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Printer connectivity test completed');
      expect(response.body.testResult).toEqual({
        connectivity: true,
        printerName: 'HP LaserJet Pro',
        status: 'Ready',
        timestamp: expect.any(String)
      });
    });

    test('should fail connectivity test when printer is disconnected', async () => {
      const mockStatus = {
        isConnected: false,
        status: 'No printer selected',
        printerId: null
      };

      mockPrinterInterface.getPrinterStatus.mockResolvedValue(mockStatus);

      const response = await request(app)
        .post('/api/printers/test')
        .expect(400);

      expect(response.body).toEqual({
        success: false,
        message: 'No printer connected or printer is offline',
        status: mockStatus
      });
    });

    test('should handle connectivity test errors', async () => {
      const errorMessage = 'Status check failed';
      mockPrinterInterface.getPrinterStatus.mockRejectedValue(new Error(errorMessage));

      const response = await request(app)
        .post('/api/printers/test')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        message: 'Printer connectivity test failed',
        error: errorMessage
      });
    });
  });

  describe('Integration Tests', () => {
    test('should complete full printer setup workflow', async () => {
      // Step 1: Discover printers
      const mockPrinters = [
        {
          id: 'printer-1',
          name: 'HP LaserJet Pro',
          isConnected: true,
          status: 'Ready',
          type: 'USB',
          platform: 'darwin'
        }
      ];
      mockPrinterInterface.discoverPrinters.mockResolvedValue(mockPrinters);

      const discoveryResponse = await request(app)
        .get('/api/printers')
        .expect(200);

      expect(discoveryResponse.body.printers).toHaveLength(1);

      // Step 2: Connect to printer
      mockPrinterInterface.connectToPrinter.mockResolvedValue(true);

      const connectResponse = await request(app)
        .post('/api/printers/printer-1/connect')
        .expect(200);

      expect(connectResponse.body.success).toBe(true);

      // Step 3: Check status
      const mockStatus = {
        isConnected: true,
        status: 'Ready',
        printerId: 'printer-1',
        printerName: 'HP LaserJet Pro'
      };
      mockPrinterInterface.getPrinterStatus.mockResolvedValue(mockStatus);

      const statusResponse = await request(app)
        .get('/api/printers/status')
        .expect(200);

      expect(statusResponse.body.status.isConnected).toBe(true);

      // Step 4: Test connectivity
      const testResponse = await request(app)
        .post('/api/printers/test')
        .expect(200);

      expect(testResponse.body.success).toBe(true);

      // Step 5: Get presets
      const mockPresets = [
        {
          name: 'default',
          description: 'Standard badge printing settings',
          options: { paperSize: 'A4', orientation: 'portrait' }
        }
      ];
      mockPrinterInterface.getAvailablePresets.mockReturnValue(mockPresets);

      const presetsResponse = await request(app)
        .get('/api/printers/presets')
        .expect(200);

      expect(presetsResponse.body.presets).toHaveLength(1);

      // Step 6: Disconnect
      mockPrinterInterface.disconnect.mockReturnValue(undefined);

      const disconnectResponse = await request(app)
        .post('/api/printers/disconnect')
        .expect(200);

      expect(disconnectResponse.body.success).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed requests gracefully', async () => {
      const response = await request(app)
        .post('/api/printers//connect')
        .expect(404);
    });

    test('should handle missing printer ID in connection request', async () => {
      const response = await request(app)
        .post('/api/printers/connect')
        .expect(404);
    });

    test('should validate printer ID format', async () => {
      const invalidPrinterId = '';
      
      const response = await request(app)
        .post(`/api/printers/${invalidPrinterId}/connect`)
        .expect(404);
    });
  });

  describe('Concurrent Operations', () => {
    test('should handle multiple discovery requests', async () => {
      const mockPrinters = [
        {
          id: 'printer-1',
          name: 'HP LaserJet Pro',
          isConnected: true,
          status: 'Ready',
          type: 'USB',
          platform: 'darwin'
        }
      ];

      mockPrinterInterface.discoverPrinters.mockResolvedValue(mockPrinters);

      // Make multiple concurrent requests
      const requests = Array(3).fill().map(() => 
        request(app).get('/api/printers').expect(200)
      );

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.body.success).toBe(true);
        expect(response.body.printers).toHaveLength(1);
      });

      expect(mockPrinterInterface.discoverPrinters).toHaveBeenCalledTimes(3);
    });

    test('should handle concurrent connection attempts', async () => {
      const printerId = 'printer-1';
      mockPrinterInterface.connectToPrinter.mockResolvedValue(true);

      // Make multiple concurrent connection requests
      const requests = Array(2).fill().map(() => 
        request(app).post(`/api/printers/${printerId}/connect`).expect(200)
      );

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.body.success).toBe(true);
      });

      expect(mockPrinterInterface.connectToPrinter).toHaveBeenCalledTimes(2);
    });
  });
});