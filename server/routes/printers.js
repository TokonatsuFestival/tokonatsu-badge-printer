const express = require('express');
const router = express.Router();

// GET /api/printers - Discover available printers
router.get('/', async (req, res, next) => {
  try {
    const printerInterface = req.app.get('printerInterface');
    const printers = await printerInterface.discoverPrinters();
    
    res.json({
      success: true,
      printers: printers,
      count: printers.length
    });
  } catch (error) {
    console.error('Printer discovery error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to discover printers',
      error: error.message
    });
  }
});

// GET /api/printers/status - Get current printer status
router.get('/status', async (req, res, next) => {
  try {
    const printerInterface = req.app.get('printerInterface');
    const status = await printerInterface.getPrinterStatus();
    
    res.json({
      success: true,
      status: status
    });
  } catch (error) {
    console.error('Printer status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get printer status',
      error: error.message
    });
  }
});

// POST /api/printers/:id/connect - Connect to a specific printer
router.post('/:id/connect', async (req, res, next) => {
  try {
    const { id } = req.params;
    const printerInterface = req.app.get('printerInterface');
    
    const success = await printerInterface.connectToPrinter(id);
    
    if (success) {
      res.json({
        success: true,
        message: `Connected to printer: ${id}`,
        printerId: id
      });
    } else {
      res.status(400).json({
        success: false,
        message: `Failed to connect to printer: ${id}`
      });
    }
  } catch (error) {
    console.error('Printer connection error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to connect to printer',
      error: error.message
    });
  }
});

// POST /api/printers/disconnect - Disconnect from current printer
router.post('/disconnect', async (req, res, next) => {
  try {
    const printerInterface = req.app.get('printerInterface');
    printerInterface.disconnect();
    
    res.json({
      success: true,
      message: 'Disconnected from printer'
    });
  } catch (error) {
    console.error('Printer disconnection error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to disconnect from printer',
      error: error.message
    });
  }
});

// GET /api/printers/presets - Get available printer presets
router.get('/presets', async (req, res, next) => {
  try {
    const printerInterface = req.app.get('printerInterface');
    const presets = printerInterface.getAvailablePresets();
    
    res.json({
      success: true,
      presets: presets
    });
  } catch (error) {
    console.error('Printer presets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get printer presets',
      error: error.message
    });
  }
});

// POST /api/printers/test - Test printer connectivity
router.post('/test', async (req, res, next) => {
  try {
    const printerInterface = req.app.get('printerInterface');
    const status = await printerInterface.getPrinterStatus();
    
    if (!status.isConnected) {
      return res.status(400).json({
        success: false,
        message: 'No printer connected or printer is offline',
        status: status
      });
    }
    
    // Test print functionality by checking if we can get printer status
    const testResult = {
      connectivity: status.isConnected,
      printerName: status.printerName || status.printerId,
      status: status.status,
      timestamp: new Date().toISOString()
    };
    
    res.json({
      success: true,
      message: 'Printer connectivity test completed',
      testResult: testResult
    });
  } catch (error) {
    console.error('Printer test error:', error);
    res.status(500).json({
      success: false,
      message: 'Printer connectivity test failed',
      error: error.message
    });
  }
});

module.exports = router;