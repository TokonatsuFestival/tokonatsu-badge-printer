const EventEmitter = require('events');

class PrintQueueManager extends EventEmitter {
  constructor(badgeJobModel, printerInterface, templateProcessor, io, options = {}) {
    super();
    
    this.badgeJobModel = badgeJobModel;
    this.printerInterface = printerInterface;
    this.templateProcessor = templateProcessor;
    this.io = io;
    
    // Configuration options
    this.options = {
      maxQueueSize: options.maxQueueSize || 50,
      maxRetries: options.maxRetries || 3,
      retryBaseDelay: options.retryBaseDelay || 1000, // 1 second
      processingTimeout: options.processingTimeout || 30000, // 30 seconds
      ...options
    };
    
    // Queue state
    this.isProcessing = false;
    this.currentJob = null;
    this.processingTimer = null;
    
    // Start processing queue
    this.startProcessing();
  }

  /**
   * Add a new job to the queue
   */
  async addJob(jobData) {
    try {
      // Check queue capacity
      const queueStats = await this.badgeJobModel.getQueueStats();
      if (queueStats.total >= this.options.maxQueueSize) {
        throw new Error(`Queue is at maximum capacity (${this.options.maxQueueSize} jobs)`);
      }

      // Create the job
      const job = await this.badgeJobModel.create(jobData);
      
      // Broadcast queue update
      this.broadcastQueueUpdate();
      
      // Emit job added event
      this.emit('jobAdded', job);
      
      return job;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get current queue status
   */
  async getQueueStatus() {
    try {
      const stats = await this.badgeJobModel.getQueueStats();
      const queuedJobs = await this.badgeJobModel.findAll('queued');
      const processingJobs = await this.badgeJobModel.findAll('processing');
      
      return {
        stats,
        queuedJobs,
        processingJobs,
        currentJob: this.currentJob,
        isProcessing: this.isProcessing
      };
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Cancel a specific job
   */
  async cancelJob(jobId) {
    try {
      const job = await this.badgeJobModel.findById(jobId);
      
      if (!job) {
        throw new Error(`Job with ID ${jobId} not found`);
      }
      
      if (job.status === 'completed') {
        throw new Error('Cannot cancel a completed job');
      }
      
      if (job.status === 'processing') {
        // If it's the current job being processed, we need to handle it specially
        if (this.currentJob && this.currentJob.id === jobId) {
          this.clearProcessingTimer();
          this.currentJob = null;
        }
      }
      
      // Delete the job
      await this.badgeJobModel.delete(jobId);
      
      // Broadcast queue update
      this.broadcastQueueUpdate();
      
      // Emit job cancelled event
      this.emit('jobCancelled', job);
      
      return true;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId) {
    try {
      const job = await this.badgeJobModel.findById(jobId);
      
      if (!job) {
        throw new Error(`Job with ID ${jobId} not found`);
      }
      
      if (job.status !== 'failed') {
        throw new Error('Only failed jobs can be retried');
      }
      
      if (job.retryCount >= this.options.maxRetries) {
        throw new Error(`Job has exceeded maximum retry attempts (${this.options.maxRetries})`);
      }
      
      // Reset job to queued status
      const updatedJob = await this.badgeJobModel.updateStatus(jobId, 'queued');
      
      // Broadcast queue update and job status change
      this.broadcastQueueUpdate();
      this.broadcastJobStatusChange(updatedJob);
      
      // Emit job retried event
      this.emit('jobRetried', updatedJob);
      
      return updatedJob;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Start the queue processing loop
   */
  startProcessing() {
    if (this.isProcessing) {
      return;
    }
    
    this.isProcessing = true;
    this.processNextJob();
  }

  /**
   * Stop the queue processing
   */
  stopProcessing() {
    this.isProcessing = false;
    this.clearProcessingTimer();
  }

  /**
   * Process the next job in the queue
   */
  async processNextJob() {
    if (!this.isProcessing || this.currentJob) {
      return;
    }
    
    try {
      // Get next job in queue
      const nextJob = await this.badgeJobModel.getNextInQueue();
      
      if (!nextJob) {
        // No jobs to process, check again in 2 seconds
        setTimeout(() => this.processNextJob(), 2000);
        return;
      }
      
      this.currentJob = nextJob;
      
      // Update job status to processing - handle case where job was deleted
      let processingJob;
      try {
        processingJob = await this.badgeJobModel.updateStatus(nextJob.id, 'processing');
      } catch (error) {
        if (error.message.includes('not found')) {
          // Job was deleted while we were trying to process it, skip it
          this.currentJob = null;
          setTimeout(() => this.processNextJob(), 100);
          return;
        }
        throw error;
      }
      
      // Set processing timeout
      this.setProcessingTimer(processingJob);
      
      // Broadcast queue update and job status change
      this.broadcastQueueUpdate();
      this.broadcastJobStatusChange(processingJob);
      
      // Emit job processing event
      this.emit('jobProcessing', processingJob);
      
      // Process the job
      await this.executeJob(nextJob);
      
    } catch (error) {
      this.emit('error', error);
      
      // Continue processing other jobs
      setTimeout(() => this.processNextJob(), 1000);
    }
  }

  /**
   * Execute a specific job
   */
  async executeJob(job) {
    try {
      // Get template model from the badge job model's connection
      const Template = require('../models/Template');
      const templateModel = new Template(this.badgeJobModel.connection);
      
      // Generate badge using template processor
      const badgeBuffer = await this.templateProcessor.generateBadge(
        job.templateId,
        job.uid,
        job.badgeName,
        templateModel
      );
      
      // Save badge to temporary file for printing
      const path = require('path');
      const fs = require('fs');
      const tempDir = path.join(__dirname, '../../data/temp');
      
      // Ensure temp directory exists
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      const tempFilePath = path.join(tempDir, `badge_${job.id}_${Date.now()}.png`);
      await this.templateProcessor.saveBadgeToFile(badgeBuffer, tempFilePath);
      
      // Send to printer
      await this.printerInterface.printDocument(tempFilePath);
      
      // Clean up temporary file
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError) {
        console.warn('Failed to clean up temporary file:', cleanupError.message);
      }
      
      // Mark job as completed
      const completedJob = await this.badgeJobModel.updateStatus(job.id, 'completed');
      
      // Clear current job
      this.clearProcessingTimer();
      this.currentJob = null;
      
      // Broadcast queue update and job status change
      this.broadcastQueueUpdate();
      this.broadcastJobStatusChange(completedJob);
      
      // Emit job completed event
      this.emit('jobCompleted', completedJob);
      
      // Process next job
      setTimeout(() => this.processNextJob(), 100);
      
    } catch (error) {
      await this.handleJobFailure(job, error);
    }
  }

  /**
   * Handle job failure with retry logic
   */
  async handleJobFailure(job, error) {
    try {
      // Increment retry count
      const updatedJob = await this.badgeJobModel.incrementRetryCount(job.id);
      
      // Check if we should retry
      if (updatedJob.retryCount < this.options.maxRetries) {
        // Calculate exponential backoff delay
        const delay = this.calculateRetryDelay(updatedJob.retryCount);
        
        // Schedule retry
        setTimeout(async () => {
          try {
            await this.badgeJobModel.updateStatus(job.id, 'queued');
            this.broadcastQueueUpdate();
            this.emit('jobRetryScheduled', updatedJob, delay);
          } catch (retryError) {
            this.emit('error', retryError);
          }
        }, delay);
        
        this.emit('jobFailedWillRetry', updatedJob, error, delay);
        
      } else {
        // Mark job as permanently failed
        const failedJob = await this.badgeJobModel.updateStatus(job.id, 'failed', error.message);
        this.broadcastJobStatusChange(failedJob);
        this.emit('jobFailed', failedJob, error);
      }
      
      // Clear current job
      this.clearProcessingTimer();
      this.currentJob = null;
      
      // Broadcast queue update
      this.broadcastQueueUpdate();
      
      // Continue processing other jobs
      setTimeout(() => this.processNextJob(), 1000);
      
    } catch (handleError) {
      this.emit('error', handleError);
      
      // Clear current job and continue
      this.clearProcessingTimer();
      this.currentJob = null;
      setTimeout(() => this.processNextJob(), 1000);
    }
  }

  /**
   * Calculate exponential backoff delay
   */
  calculateRetryDelay(retryCount) {
    return this.options.retryBaseDelay * Math.pow(2, retryCount - 1);
  }

  /**
   * Set processing timeout for current job
   */
  setProcessingTimer(job) {
    this.clearProcessingTimer();
    
    this.processingTimer = setTimeout(async () => {
      try {
        const error = new Error(`Job processing timeout after ${this.options.processingTimeout}ms`);
        await this.handleJobFailure(job, error);
      } catch (timeoutError) {
        this.emit('error', timeoutError);
      }
    }, this.options.processingTimeout);
  }

  /**
   * Clear processing timeout
   */
  clearProcessingTimer() {
    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
      this.processingTimer = null;
    }
  }

  /**
   * Broadcast queue status update via Socket.io
   */
  async broadcastQueueUpdate() {
    try {
      const queueStatus = await this.getQueueStatus();
      this.io.emit('queueUpdate', queueStatus);
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Broadcast individual job status change via Socket.io
   */
  broadcastJobStatusChange(job) {
    try {
      this.io.emit('jobStatusChange', {
        id: job.id,
        templateId: job.templateId,
        uid: job.uid,
        badgeName: job.badgeName,
        status: job.status,
        retryCount: job.retryCount,
        errorMessage: job.errorMessage,
        createdAt: job.createdAt,
        processedAt: job.processedAt
      });
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Get queue capacity information
   */
  async getQueueCapacity() {
    const stats = await this.badgeJobModel.getQueueStats();
    return {
      current: stats.total,
      maximum: this.options.maxQueueSize,
      available: this.options.maxQueueSize - stats.total,
      percentFull: Math.round((stats.total / this.options.maxQueueSize) * 100)
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    this.stopProcessing();
    this.removeAllListeners();
  }
}

module.exports = PrintQueueManager;