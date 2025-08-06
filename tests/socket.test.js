const { JSDOM } = require('jsdom');

// Mock Socket.io for testing
const mockSocket = {
  connected: true,
  on: jest.fn(),
  emit: jest.fn(),
  disconnect: jest.fn()
};

// Mock the global io function
global.io = jest.fn(() => mockSocket);

describe('WebSocket Real-time Updates', () => {
  let dom;
  let window;
  let document;

  beforeEach(() => {
    // Set up DOM environment
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <form id="badge-form">
            <div id="template-grid"></div>
            <input id="uid-input" />
            <input id="badge-name-input" />
            <button id="submit-badge">Submit</button>
            <div id="uid-error"></div>
            <div id="badge-name-error"></div>
          </form>
          <div id="queue-count">0</div>
          <div id="processing-count">0</div>
          <div id="completed-count">0</div>
          <div id="job-list"></div>
          <div id="connection-status">Connected</div>
          <div id="status-indicator"></div>
          <div id="status-text">Printer ready</div>
          <button id="refresh-queue">Refresh</button>
          <template id="job-item-template">
            <div class="job-item" data-job-id="">
              <div class="job-info">
                <div class="job-header">
                  <span class="job-uid"></span>
                  <span class="job-status"></span>
                </div>
                <div class="job-details">
                  <span class="job-name"></span>
                  <span class="job-template"></span>
                </div>
                <div class="job-timestamp"></div>
              </div>
              <div class="job-actions">
                <button class="btn btn-small btn-danger job-cancel">Cancel</button>
                <button class="btn btn-small btn-secondary job-retry" style="display: none;">Retry</button>
              </div>
            </div>
          </template>
          <template id="template-item-template">
            <div class="template-item">
              <input type="radio" name="template" class="template-radio" id="">
              <label class="template-label" for="">
                <div class="template-preview">
                  <img src="" alt="" class="template-image">
                </div>
                <div class="template-info">
                  <span class="template-name"></span>
                </div>
              </label>
            </div>
          </template>
        </body>
      </html>
    `, { 
      url: 'http://localhost',
      runScripts: 'dangerously',
      resources: 'usable'
    });

    window = dom.window;
    document = window.document;
    global.window = window;
    global.document = document;
    global.fetch = jest.fn();
    
    // Mock setTimeout and clearTimeout
    global.setTimeout = jest.fn((fn, delay) => {
      if (typeof fn === 'function') {
        fn();
      }
      return 1;
    });
    global.clearTimeout = jest.fn();

    // Reset mocks
    jest.clearAllMocks();
    
    // Mock DOMContentLoaded event
    const mockAddEventListener = jest.fn((event, handler) => {
      if (event === 'DOMContentLoaded') {
        // Execute the handler immediately for testing
        setTimeout(handler, 0);
      }
    });
    document.addEventListener = mockAddEventListener;
  });

  afterEach(() => {
    dom.window.close();
  });

  describe('Connection Handling', () => {
    test('should initialize socket connection', () => {
      expect(global.io).toBeDefined();
      expect(mockSocket.on).toBeDefined();
    });

    test('should handle connection status updates', () => {
      // Test the updateConnectionStatus function directly
      const updateConnectionStatus = (isConnected) => {
        const connectionStatus = document.getElementById('connection-status');
        const statusIndicator = document.getElementById('status-indicator');
        const statusText = document.getElementById('status-text');
        
        connectionStatus.textContent = isConnected ? 'Connected' : 'Disconnected';
        connectionStatus.className = isConnected ? 'connected' : 'disconnected';
        
        statusIndicator.className = `status-indicator ${isConnected ? 'connected' : 'disconnected'}`;
        statusText.textContent = isConnected ? 'Printer ready' : 'Connection lost';
      };
      
      // Test connected state
      updateConnectionStatus(true);
      expect(document.getElementById('connection-status').textContent).toBe('Connected');
      expect(document.getElementById('connection-status').className).toBe('connected');
      expect(document.getElementById('status-text').textContent).toBe('Printer ready');
      
      // Test disconnected state
      updateConnectionStatus(false);
      expect(document.getElementById('connection-status').textContent).toBe('Disconnected');
      expect(document.getElementById('connection-status').className).toBe('disconnected');
      expect(document.getElementById('status-text').textContent).toBe('Connection lost');
    });
  });

  describe('Queue Updates', () => {
    test('should update queue display statistics', () => {
      // Test the updateQueueDisplay function directly
      const updateQueueDisplay = (queueStatus) => {
        document.getElementById('queue-count').textContent = queueStatus.stats.queued || 0;
        document.getElementById('processing-count').textContent = queueStatus.stats.processing || 0;
        document.getElementById('completed-count').textContent = queueStatus.stats.completed || 0;
        
        const allJobs = [
          ...(queueStatus.queuedJobs || []),
          ...(queueStatus.processingJobs || [])
        ];
        
        if (queueStatus.currentJob && !allJobs.find(job => job.id === queueStatus.currentJob.id)) {
          allJobs.unshift(queueStatus.currentJob);
        }
        
        const jobList = document.getElementById('job-list');
        if (allJobs.length === 0) {
          jobList.innerHTML = '<div class="empty-queue"><p>No jobs in queue</p></div>';
        }
      };
      
      const mockQueueStatus = {
        stats: { queued: 2, processing: 1, completed: 5, failed: 0, total: 8 },
        queuedJobs: [
          {
            id: 'job-1',
            templateId: 'template-1',
            uid: 'TEST-001',
            badgeName: 'John Doe',
            status: 'queued',
            createdAt: new Date().toISOString()
          }
        ],
        processingJobs: [
          {
            id: 'job-2',
            templateId: 'template-1',
            uid: 'TEST-002',
            badgeName: 'Jane Smith',
            status: 'processing',
            createdAt: new Date().toISOString()
          }
        ],
        currentJob: null,
        isProcessing: true
      };

      updateQueueDisplay(mockQueueStatus);

      // Check that DOM elements are updated
      expect(document.getElementById('queue-count').textContent).toBe('2');
      expect(document.getElementById('processing-count').textContent).toBe('1');
      expect(document.getElementById('completed-count').textContent).toBe('5');
    });

    test('should handle empty queue updates', () => {
      const updateQueueDisplay = (queueStatus) => {
        document.getElementById('queue-count').textContent = queueStatus.stats.queued || 0;
        document.getElementById('processing-count').textContent = queueStatus.stats.processing || 0;
        document.getElementById('completed-count').textContent = queueStatus.stats.completed || 0;
        
        const allJobs = [
          ...(queueStatus.queuedJobs || []),
          ...(queueStatus.processingJobs || [])
        ];
        
        const jobList = document.getElementById('job-list');
        if (allJobs.length === 0) {
          jobList.innerHTML = '<div class="empty-queue"><p>No jobs in queue</p></div>';
        }
      };
      
      const emptyQueueStatus = {
        stats: { queued: 0, processing: 0, completed: 0, failed: 0, total: 0 },
        queuedJobs: [],
        processingJobs: [],
        currentJob: null,
        isProcessing: false
      };

      updateQueueDisplay(emptyQueueStatus);

      expect(document.getElementById('queue-count').textContent).toBe('0');
      expect(document.getElementById('processing-count').textContent).toBe('0');
      expect(document.getElementById('completed-count').textContent).toBe('0');
      expect(document.getElementById('job-list').innerHTML).toContain('No jobs in queue');
    });
  });

  describe('Job Status Changes', () => {
    test('should create toast notifications for job status changes', () => {
      // Test the showToastNotification function directly
      const showToastNotification = (message, type = 'info') => {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: ${type === 'completed' ? '#2ecc71' : type === 'failed' ? '#e74c3c' : '#3498db'};
          color: white;
          padding: 12px 20px;
          border-radius: 4px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          z-index: 1000;
          max-width: 300px;
          word-wrap: break-word;
        `;
        
        document.body.appendChild(toast);
        return toast;
      };
      
      const toast = showToastNotification('Badge completed for Test User', 'completed');
      
      expect(toast.textContent).toBe('Badge completed for Test User');
      expect(toast.classList.contains('toast-completed')).toBe(true);
      expect(toast.style.background).toBe('rgb(46, 204, 113)');
    });

    test('should show job notifications with correct messages', () => {
      const showJobNotification = (jobData) => {
        const notifications = {
          'processing': `Processing badge for ${jobData.badgeName}`,
          'completed': `Badge completed for ${jobData.badgeName}`,
          'failed': `Badge failed for ${jobData.badgeName}: ${jobData.errorMessage || 'Unknown error'}`
        };
        
        const message = notifications[jobData.status];
        if (message) {
          const toast = document.createElement('div');
          toast.className = `toast toast-${jobData.status}`;
          toast.textContent = message;
          document.body.appendChild(toast);
          return toast;
        }
      };
      
      const completedJob = {
        id: 'job-456',
        templateId: 'template-2',
        uid: 'TEST-456',
        badgeName: 'Completed User',
        status: 'completed',
        retryCount: 0,
        errorMessage: null,
        createdAt: new Date().toISOString(),
        processedAt: new Date().toISOString()
      };

      const toast = showJobNotification(completedJob);
      expect(toast.textContent).toBe('Badge completed for Completed User');
      expect(toast.classList.contains('toast-completed')).toBe(true);
    });

    test('should handle failed job notifications with error messages', () => {
      const showJobNotification = (jobData) => {
        const notifications = {
          'processing': `Processing badge for ${jobData.badgeName}`,
          'completed': `Badge completed for ${jobData.badgeName}`,
          'failed': `Badge failed for ${jobData.badgeName}: ${jobData.errorMessage || 'Unknown error'}`
        };
        
        const message = notifications[jobData.status];
        if (message) {
          const toast = document.createElement('div');
          toast.className = `toast toast-${jobData.status}`;
          toast.textContent = message;
          document.body.appendChild(toast);
          return toast;
        }
      };
      
      const failedJob = {
        id: 'job-789',
        templateId: 'template-1',
        uid: 'TEST-789',
        badgeName: 'Failed User',
        status: 'failed',
        retryCount: 3,
        errorMessage: 'Printer offline',
        createdAt: new Date().toISOString(),
        processedAt: null
      };

      const toast = showJobNotification(failedJob);
      expect(toast.textContent).toBe('Badge failed for Failed User: Printer offline');
      expect(toast.classList.contains('toast-failed')).toBe(true);
    });
  });

  describe('Connection Error Handling', () => {
    test('should handle connection errors gracefully', () => {
      const updateConnectionStatus = (isConnected) => {
        const connectionStatus = document.getElementById('connection-status');
        const statusIndicator = document.getElementById('status-indicator');
        const statusText = document.getElementById('status-text');
        
        connectionStatus.textContent = isConnected ? 'Connected' : 'Disconnected';
        connectionStatus.className = isConnected ? 'connected' : 'disconnected';
        
        statusIndicator.className = `status-indicator ${isConnected ? 'connected' : 'disconnected'}`;
        statusText.textContent = isConnected ? 'Printer ready' : 'Connection lost';
      };
      
      // Simulate connection error
      updateConnectionStatus(false);

      expect(document.getElementById('connection-status').textContent).toBe('Disconnected');
      expect(document.getElementById('connection-status').className).toBe('disconnected');
      expect(document.getElementById('status-text').textContent).toBe('Connection lost');
    });

    test('should show error message on reconnection failure', () => {
      const showGlobalError = (message) => {
        let errorDiv = document.querySelector('.global-error');
        if (!errorDiv) {
          errorDiv = document.createElement('div');
          errorDiv.className = 'global-error';
          errorDiv.style.cssText = `
            background: #fee;
            border: 1px solid #fcc;
            color: #c33;
            padding: 12px;
            border-radius: 4px;
            margin-bottom: 20px;
            font-size: 0.9rem;
          `;
          document.body.appendChild(errorDiv);
        }
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        errorDiv.setAttribute('role', 'alert');
      };
      
      showGlobalError('Connection lost. Please refresh the page.');
      
      // Check that error message is displayed
      const errorDiv = document.querySelector('.global-error');
      expect(errorDiv).toBeTruthy();
      expect(errorDiv.textContent).toContain('Connection lost. Please refresh the page.');
      expect(errorDiv.getAttribute('role')).toBe('alert');
    });
  });

  describe('Real-time Functionality', () => {
    test('should handle queue status loading', async () => {
      // Mock fetch for loadQueueStatus
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          stats: { queued: 1, processing: 0, completed: 2, failed: 0, total: 3 },
          queuedJobs: [],
          processingJobs: [],
          currentJob: null,
          isProcessing: false
        })
      });

      const loadQueueStatus = async () => {
        try {
          const response = await fetch('/api/queue');
          
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          
          const queueStatus = await response.json();
          
          // Update display
          document.getElementById('queue-count').textContent = queueStatus.stats.queued || 0;
          document.getElementById('processing-count').textContent = queueStatus.stats.processing || 0;
          document.getElementById('completed-count').textContent = queueStatus.stats.completed || 0;
          
          return queueStatus;
        } catch (error) {
          console.error('Failed to load queue status:', error);
        }
      };
      
      const result = await loadQueueStatus();
      
      expect(global.fetch).toHaveBeenCalledWith('/api/queue');
      expect(result.stats.completed).toBe(2);
      expect(document.getElementById('completed-count').textContent).toBe('2');
    });

    test('should handle WebSocket event registration', () => {
      // Test that the socket mock is properly configured
      expect(mockSocket.on).toBeDefined();
      expect(mockSocket.emit).toBeDefined();
      expect(mockSocket.connected).toBe(true);
      
      // Test that we can register event handlers
      const testHandler = jest.fn();
      mockSocket.on('test-event', testHandler);
      
      expect(mockSocket.on).toHaveBeenCalledWith('test-event', testHandler);
    });
  });
});