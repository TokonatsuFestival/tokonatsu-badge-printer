const DatabaseSchema = require('../server/database/schema');
const BadgeJob = require('../server/models/BadgeJob');
const path = require('path');

describe('BadgeJob Model', () => {
  let schema;
  let badgeJob;

  beforeEach(async () => {
    schema = new DatabaseSchema();
    schema.connection.dbPath = ':memory:';
    await schema.initialize();
    badgeJob = new BadgeJob(schema.connection);
  });

  afterEach(async () => {
    await schema.close();
  });

  describe('create', () => {
    test('should create a new badge job successfully', async () => {
      const jobData = {
        templateId: 'template-1',
        uid: 'USER001',
        badgeName: 'John Doe'
      };

      const job = await badgeJob.create(jobData);
      
      expect(job).toHaveProperty('id');
      expect(job.templateId).toBe(jobData.templateId);
      expect(job.uid).toBe(jobData.uid);
      expect(job.badgeName).toBe(jobData.badgeName);
      expect(job.status).toBe('queued');
      expect(job.retryCount).toBe(0);
      expect(job.createdAt).toBeInstanceOf(Date);
    });

    test('should throw error for missing required fields', async () => {
      const incompleteData = {
        templateId: 'template-1',
        uid: 'USER001'
        // missing badgeName
      };

      await expect(badgeJob.create(incompleteData)).rejects.toThrow('Missing required fields');
    });

    test('should throw error for duplicate UID in active jobs', async () => {
      const jobData = {
        templateId: 'template-1',
        uid: 'USER001',
        badgeName: 'John Doe'
      };

      await badgeJob.create(jobData);
      
      // Try to create another job with same UID
      await expect(badgeJob.create(jobData)).rejects.toThrow('UID \'USER001\' is already in use');
    });

    test('should allow duplicate UID if previous job is completed', async () => {
      const jobData = {
        templateId: 'template-1',
        uid: 'USER001',
        badgeName: 'John Doe'
      };

      const firstJob = await badgeJob.create(jobData);
      await badgeJob.updateStatus(firstJob.id, 'completed');
      
      // Should be able to create new job with same UID
      const secondJob = await badgeJob.create(jobData);
      expect(secondJob.id).not.toBe(firstJob.id);
      expect(secondJob.uid).toBe(jobData.uid);
    });
  });

  describe('findById', () => {
    test('should find badge job by ID', async () => {
      const jobData = {
        templateId: 'template-1',
        uid: 'USER001',
        badgeName: 'John Doe'
      };

      const createdJob = await badgeJob.create(jobData);
      const foundJob = await badgeJob.findById(createdJob.id);
      
      expect(foundJob).toEqual(createdJob);
    });

    test('should return null for non-existent ID', async () => {
      const job = await badgeJob.findById('non-existent-id');
      expect(job).toBeNull();
    });
  });

  describe('findAll', () => {
    test('should return all badge jobs', async () => {
      const jobData1 = { templateId: 'template-1', uid: 'USER001', badgeName: 'John Doe' };
      const jobData2 = { templateId: 'template-2', uid: 'USER002', badgeName: 'Jane Smith' };

      await badgeJob.create(jobData1);
      await badgeJob.create(jobData2);

      const jobs = await badgeJob.findAll();
      expect(jobs).toHaveLength(2);
    });

    test('should filter by status', async () => {
      const jobData1 = { templateId: 'template-1', uid: 'USER001', badgeName: 'John Doe' };
      const jobData2 = { templateId: 'template-2', uid: 'USER002', badgeName: 'Jane Smith' };

      const job1 = await badgeJob.create(jobData1);
      await badgeJob.create(jobData2);
      await badgeJob.updateStatus(job1.id, 'completed');

      const queuedJobs = await badgeJob.findAll('queued');
      expect(queuedJobs).toHaveLength(1);
      expect(queuedJobs[0].uid).toBe('USER002');
    });
  });

  describe('updateStatus', () => {
    test('should update job status successfully', async () => {
      const jobData = {
        templateId: 'template-1',
        uid: 'USER001',
        badgeName: 'John Doe'
      };

      const job = await badgeJob.create(jobData);
      const updatedJob = await badgeJob.updateStatus(job.id, 'processing');
      
      expect(updatedJob.status).toBe('processing');
      expect(updatedJob.processedAt).toBeNull();
    });

    test('should set processedAt for completed status', async () => {
      const jobData = {
        templateId: 'template-1',
        uid: 'USER001',
        badgeName: 'John Doe'
      };

      const job = await badgeJob.create(jobData);
      const updatedJob = await badgeJob.updateStatus(job.id, 'completed');
      
      expect(updatedJob.status).toBe('completed');
      expect(updatedJob.processedAt).toBeInstanceOf(Date);
    });

    test('should set error message for failed status', async () => {
      const jobData = {
        templateId: 'template-1',
        uid: 'USER001',
        badgeName: 'John Doe'
      };

      const job = await badgeJob.create(jobData);
      const errorMessage = 'Printer offline';
      const updatedJob = await badgeJob.updateStatus(job.id, 'failed', errorMessage);
      
      expect(updatedJob.status).toBe('failed');
      expect(updatedJob.errorMessage).toBe(errorMessage);
      expect(updatedJob.processedAt).toBeInstanceOf(Date);
    });

    test('should throw error for invalid status', async () => {
      const jobData = {
        templateId: 'template-1',
        uid: 'USER001',
        badgeName: 'John Doe'
      };

      const job = await badgeJob.create(jobData);
      
      await expect(badgeJob.updateStatus(job.id, 'invalid-status')).rejects.toThrow('Invalid status');
    });

    test('should throw error for non-existent job', async () => {
      await expect(badgeJob.updateStatus('non-existent-id', 'completed')).rejects.toThrow('not found');
    });
  });

  describe('incrementRetryCount', () => {
    test('should increment retry count', async () => {
      const jobData = {
        templateId: 'template-1',
        uid: 'USER001',
        badgeName: 'John Doe'
      };

      const job = await badgeJob.create(jobData);
      const updatedJob = await badgeJob.incrementRetryCount(job.id);
      
      expect(updatedJob.retryCount).toBe(1);
    });
  });

  describe('delete', () => {
    test('should delete badge job successfully', async () => {
      const jobData = {
        templateId: 'template-1',
        uid: 'USER001',
        badgeName: 'John Doe'
      };

      const job = await badgeJob.create(jobData);
      const result = await badgeJob.delete(job.id);
      
      expect(result).toBe(true);
      
      const deletedJob = await badgeJob.findById(job.id);
      expect(deletedJob).toBeNull();
    });

    test('should throw error for non-existent job', async () => {
      await expect(badgeJob.delete('non-existent-id')).rejects.toThrow('not found');
    });
  });

  describe('getQueueStats', () => {
    test('should return queue statistics', async () => {
      const jobData1 = { templateId: 'template-1', uid: 'USER001', badgeName: 'John Doe' };
      const jobData2 = { templateId: 'template-2', uid: 'USER002', badgeName: 'Jane Smith' };
      const jobData3 = { templateId: 'template-3', uid: 'USER003', badgeName: 'Bob Wilson' };

      const job1 = await badgeJob.create(jobData1);
      const job2 = await badgeJob.create(jobData2);
      await badgeJob.create(jobData3);
      
      await badgeJob.updateStatus(job1.id, 'processing');
      await badgeJob.updateStatus(job2.id, 'completed');

      const stats = await badgeJob.getQueueStats();
      
      expect(stats.queued).toBe(1);
      expect(stats.processing).toBe(1);
      expect(stats.total).toBe(2);
    });
  });

  describe('getNextInQueue', () => {
    test('should return next job in queue', async () => {
      const jobData1 = { templateId: 'template-1', uid: 'USER001', badgeName: 'John Doe' };
      const jobData2 = { templateId: 'template-2', uid: 'USER002', badgeName: 'Jane Smith' };

      await badgeJob.create(jobData1);
      await badgeJob.create(jobData2);

      const nextJob = await badgeJob.getNextInQueue();
      expect(nextJob.uid).toBe('USER001'); // First created should be first in queue
    });

    test('should return null when no jobs in queue', async () => {
      const nextJob = await badgeJob.getNextInQueue();
      expect(nextJob).toBeNull();
    });
  });

  describe('isUidUnique', () => {
    test('should return true for unique UID', async () => {
      const isUnique = await badgeJob.isUidUnique('UNIQUE001');
      expect(isUnique).toBe(true);
    });

    test('should return false for duplicate UID in active jobs', async () => {
      const jobData = {
        templateId: 'template-1',
        uid: 'USER001',
        badgeName: 'John Doe'
      };

      await badgeJob.create(jobData);
      
      const isUnique = await badgeJob.isUidUnique('USER001');
      expect(isUnique).toBe(false);
    });

    test('should return true for UID in completed jobs', async () => {
      const jobData = {
        templateId: 'template-1',
        uid: 'USER001',
        badgeName: 'John Doe'
      };

      const job = await badgeJob.create(jobData);
      await badgeJob.updateStatus(job.id, 'completed');
      
      const isUnique = await badgeJob.isUidUnique('USER001');
      expect(isUnique).toBe(true);
    });
  });
});