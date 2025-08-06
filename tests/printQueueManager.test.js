const PrintQueueManager = require('../server/services/PrintQueueManager');
const EventEmitter = require('events');

// Mock dependencies
const mockBadgeJobModel = {
  create: jest.fn(),
  findById: jest.fn(),
  findAll: jest.fn(),
  updateStatus: jest.fn(),
  incrementRetryCount: jest.fn(),
  delete: jest.fn(),
  getQueueStats: jest.fn(),
  getNextInQueue: jest.fn()
};

const mockPrinterInterface = {
  printDocument: jest.fn()
};

const mockTemplateProcessor = {
  generateBadge: jest.fn()
};

const mockIo = {
  emit: jest.fn()
};

describe('PrintQueueManager', () => {
  let queueManager;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create new queue manager instance
    queueManager = new PrintQueueManager(
      mockBadgeJobModel,
      mockPrinterInterface,
      mockTemplateProcessor,
      mockIo,
      {
        maxQueueSize: 5,
        maxRetries: 2,
        retryBaseDelay: 100,
        processingTimeout: 1000
      }
    );
    
    // Stop automatic processing for tests
    queueManager.stopProcessing();
  });
  
  afterEach(async () => {
    await queueManager.cleanup();
  });

  describe('addJob', () => {
    it('should add a job to the queue when under capacity', async () => {
      const jobData = { templateId: 'template1', uid: 'user123', badgeName: 'John Doe' };
      const createdJob = { id: 'job1', ...jobData, status: 'queued' };
      
      mockBadgeJobModel.getQueueStats.mockResolvedValue({ total: 2 });
      mockBadgeJobModel.create.mockResolvedValue(createdJob);
      mockBadgeJobModel.findAll.mockResolvedValue([]);
      
      const result = await queueManager.addJob(jobData);
      
      // Wait a bit for async broadcastQueueUpdate to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(mockBadgeJobModel.create).toHaveBeenCalledWith(jobData);
      expect(mockIo.emit).toHaveBeenCalledWith('queueUpdate', expect.any(Object));
      expect(result).toEqual(createdJob);
    });
    
    it('should reject job when queue is at maximum capacity', async () => {
      const jobData = { templateId: 'template1', uid: 'user123', badgeName: 'John Doe' };
      
      mockBadgeJobModel.getQueueStats.mockResolvedValue({ total: 5 });
      
      await expect(queueManager.addJob(jobData)).rejects.toThrow('Queue is at maximum capacity (5 jobs)');
      expect(mockBadgeJobModel.create).not.toHaveBeenCalled();
    });
    
    it('should emit jobAdded event when job is successfully added', async () => {
      const jobData = { templateId: 'template1', uid: 'user123', badgeName: 'John Doe' };
      const createdJob = { id: 'job1', ...jobData, status: 'queued' };
      
      mockBadgeJobModel.getQueueStats.mockResolvedValue({ total: 2 });
      mockBadgeJobModel.create.mockResolvedValue(createdJob);
      
      const eventSpy = jest.fn();
      queueManager.on('jobAdded', eventSpy);
      
      await queueManager.addJob(jobData);
      
      expect(eventSpy).toHaveBeenCalledWith(createdJob);
    });
  });

  describe('getQueueStatus', () => {
    it('should return complete queue status', async () => {
      const stats = { queued: 2, processing: 1, total: 3 };
      const queuedJobs = [{ id: 'job1', status: 'queued' }, { id: 'job2', status: 'queued' }];
      const processingJobs = [{ id: 'job3', status: 'processing' }];
      
      mockBadgeJobModel.getQueueStats.mockResolvedValue(stats);
      mockBadgeJobModel.findAll.mockImplementation((status) => {
        if (status === 'queued') return Promise.resolve(queuedJobs);
        if (status === 'processing') return Promise.resolve(processingJobs);
        return Promise.resolve([]);
      });
      
      const result = await queueManager.getQueueStatus();
      
      expect(result).toEqual({
        stats,
        queuedJobs,
        processingJobs,
        currentJob: null,
        isProcessing: false
      });
    });
  });

  describe('cancelJob', () => {
    it('should cancel a queued job successfully', async () => {
      const job = { id: 'job1', status: 'queued' };
      
      mockBadgeJobModel.findById.mockResolvedValue(job);
      mockBadgeJobModel.delete.mockResolvedValue(true);
      mockBadgeJobModel.getQueueStats.mockResolvedValue({ total: 1 });
      mockBadgeJobModel.findAll.mockResolvedValue([]);
      
      const eventSpy = jest.fn();
      queueManager.on('jobCancelled', eventSpy);
      
      const result = await queueManager.cancelJob('job1');
      
      // Wait a bit for async broadcastQueueUpdate to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(mockBadgeJobModel.delete).toHaveBeenCalledWith('job1');
      expect(mockIo.emit).toHaveBeenCalledWith('queueUpdate', expect.any(Object));
      expect(eventSpy).toHaveBeenCalledWith(job);
      expect(result).toBe(true);
    });
    
    it('should reject cancelling a completed job', async () => {
      const job = { id: 'job1', status: 'completed' };
      
      mockBadgeJobModel.findById.mockResolvedValue(job);
      
      await expect(queueManager.cancelJob('job1')).rejects.toThrow('Cannot cancel a completed job');
      expect(mockBadgeJobModel.delete).not.toHaveBeenCalled();
    });
    
    it('should reject cancelling a non-existent job', async () => {
      mockBadgeJobModel.findById.mockResolvedValue(null);
      
      await expect(queueManager.cancelJob('nonexistent')).rejects.toThrow('Job with ID nonexistent not found');
    });
  });

  describe('retryJob', () => {
    it('should retry a failed job with retries remaining', async () => {
      const job = { id: 'job1', status: 'failed', retryCount: 1 };
      const updatedJob = { ...job, status: 'queued' };
      
      mockBadgeJobModel.findById.mockResolvedValue(job);
      mockBadgeJobModel.updateStatus.mockResolvedValue(updatedJob);
      mockBadgeJobModel.getQueueStats.mockResolvedValue({ total: 1 });
      mockBadgeJobModel.findAll.mockResolvedValue([]);
      
      const eventSpy = jest.fn();
      queueManager.on('jobRetried', eventSpy);
      
      const result = await queueManager.retryJob('job1');
      
      // Wait a bit for async broadcastQueueUpdate to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(mockBadgeJobModel.updateStatus).toHaveBeenCalledWith('job1', 'queued');
      expect(mockIo.emit).toHaveBeenCalledWith('queueUpdate', expect.any(Object));
      expect(eventSpy).toHaveBeenCalledWith(updatedJob);
      expect(result).toEqual(updatedJob);
    });
    
    it('should reject retrying a job that has exceeded max retries', async () => {
      const job = { id: 'job1', status: 'failed', retryCount: 2 };
      
      mockBadgeJobModel.findById.mockResolvedValue(job);
      
      await expect(queueManager.retryJob('job1')).rejects.toThrow('Job has exceeded maximum retry attempts (2)');
      expect(mockBadgeJobModel.updateStatus).not.toHaveBeenCalled();
    });
    
    it('should reject retrying a non-failed job', async () => {
      const job = { id: 'job1', status: 'queued', retryCount: 0 };
      
      mockBadgeJobModel.findById.mockResolvedValue(job);
      
      await expect(queueManager.retryJob('job1')).rejects.toThrow('Only failed jobs can be retried');
    });
  });

  describe('executeJob', () => {
    it('should execute a job successfully', async () => {
      const job = { id: 'job1', templateId: 'template1', uid: 'user123', badgeName: 'John Doe' };
      const badgeDocument = 'generated-badge-data';
      
      mockTemplateProcessor.generateBadge.mockResolvedValue(badgeDocument);
      mockPrinterInterface.printDocument.mockResolvedValue(true);
      mockBadgeJobModel.updateStatus.mockResolvedValue({ ...job, status: 'completed' });
      
      const eventSpy = jest.fn();
      queueManager.on('jobCompleted', eventSpy);
      
      await queueManager.executeJob(job);
      
      expect(mockTemplateProcessor.generateBadge).toHaveBeenCalledWith('template1', 'user123', 'John Doe');
      expect(mockPrinterInterface.printDocument).toHaveBeenCalledWith(badgeDocument);
      expect(mockBadgeJobModel.updateStatus).toHaveBeenCalledWith('job1', 'completed');
      expect(eventSpy).toHaveBeenCalledWith(job);
    });
    
    it('should handle job execution failure with retry logic', async () => {
      const job = { id: 'job1', templateId: 'template1', uid: 'user123', badgeName: 'John Doe', retryCount: 0 };
      const updatedJob = { ...job, retryCount: 1 };
      const error = new Error('Printer offline');
      
      mockTemplateProcessor.generateBadge.mockRejectedValue(error);
      mockBadgeJobModel.incrementRetryCount.mockResolvedValue(updatedJob);
      mockBadgeJobModel.updateStatus.mockResolvedValue({ ...updatedJob, status: 'queued' });
      
      const eventSpy = jest.fn();
      queueManager.on('jobFailedWillRetry', eventSpy);
      
      await queueManager.executeJob(job);
      
      expect(mockBadgeJobModel.incrementRetryCount).toHaveBeenCalledWith('job1');
      
      // Wait for retry delay
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(mockBadgeJobModel.updateStatus).toHaveBeenCalledWith('job1', 'queued');
      expect(eventSpy).toHaveBeenCalledWith(updatedJob, error, expect.any(Number));
    });
    
    it('should mark job as permanently failed after max retries', async () => {
      const job = { id: 'job1', templateId: 'template1', uid: 'user123', badgeName: 'John Doe', retryCount: 1 };
      const updatedJob = { ...job, retryCount: 2 };
      const error = new Error('Printer offline');
      
      mockTemplateProcessor.generateBadge.mockRejectedValue(error);
      mockBadgeJobModel.incrementRetryCount.mockResolvedValue(updatedJob);
      mockBadgeJobModel.updateStatus.mockResolvedValue({ ...updatedJob, status: 'failed' });
      
      const eventSpy = jest.fn();
      queueManager.on('jobFailed', eventSpy);
      
      await queueManager.executeJob(job);
      
      expect(mockBadgeJobModel.updateStatus).toHaveBeenCalledWith('job1', 'failed', 'Printer offline');
      expect(eventSpy).toHaveBeenCalledWith(updatedJob, error);
    });
  });

  describe('calculateRetryDelay', () => {
    it('should calculate exponential backoff delays correctly', () => {
      expect(queueManager.calculateRetryDelay(1)).toBe(100); // base delay
      expect(queueManager.calculateRetryDelay(2)).toBe(200); // base * 2^1
      expect(queueManager.calculateRetryDelay(3)).toBe(400); // base * 2^2
    });
  });

  describe('getQueueCapacity', () => {
    it('should return queue capacity information', async () => {
      mockBadgeJobModel.getQueueStats.mockResolvedValue({ total: 3 });
      
      const result = await queueManager.getQueueCapacity();
      
      expect(result).toEqual({
        current: 3,
        maximum: 5,
        available: 2,
        percentFull: 60
      });
    });
  });

  describe('broadcastQueueUpdate', () => {
    it('should broadcast queue status via Socket.io', async () => {
      const queueStatus = { stats: { total: 2 }, queuedJobs: [], processingJobs: [] };
      
      mockBadgeJobModel.getQueueStats.mockResolvedValue({ total: 2 });
      mockBadgeJobModel.findAll.mockResolvedValue([]);
      
      await queueManager.broadcastQueueUpdate();
      
      expect(mockIo.emit).toHaveBeenCalledWith('queueUpdate', expect.objectContaining({
        stats: { total: 2 }
      }));
    });
  });

  describe('processing control', () => {
    it('should start and stop processing correctly', () => {
      expect(queueManager.isProcessing).toBe(false);
      
      queueManager.startProcessing();
      expect(queueManager.isProcessing).toBe(true);
      
      queueManager.stopProcessing();
      expect(queueManager.isProcessing).toBe(false);
    });
  });

  describe('event handling', () => {
    it('should emit error events when operations fail', async () => {
      const error = new Error('Database error');
      mockBadgeJobModel.getQueueStats.mockRejectedValue(error);
      
      const errorSpy = jest.fn();
      queueManager.on('error', errorSpy);
      
      await expect(queueManager.addJob({ templateId: 'test', uid: 'test', badgeName: 'test' }))
        .rejects.toThrow('Database error');
      
      expect(errorSpy).toHaveBeenCalledWith(error);
    });
  });

  describe('cleanup', () => {
    it('should cleanup resources properly', async () => {
      queueManager.startProcessing();
      
      await queueManager.cleanup();
      
      expect(queueManager.isProcessing).toBe(false);
      expect(queueManager.listenerCount('error')).toBe(0);
    });
  });
});