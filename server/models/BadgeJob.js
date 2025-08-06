const { v4: uuidv4 } = require('uuid');

class BadgeJob {
  constructor(connection) {
    this.connection = connection;
  }

  // Create a new badge job
  async create(jobData) {
    const { templateId, uid, badgeName, badgeImage } = jobData;
    
    // Validate required fields
    if (!templateId || !uid || !badgeName) {
      throw new Error('Missing required fields: templateId, uid, and badgeName are required');
    }

    // Validate UID uniqueness within current session (queued or processing jobs)
    const existingJob = await this.connection.get(
      'SELECT id FROM badge_jobs WHERE uid = ? AND status IN (?, ?)',
      [uid, 'queued', 'processing']
    );

    if (existingJob) {
      throw new Error(`UID '${uid}' is already in use by an active job`);
    }

    const id = uuidv4();
    const createdAt = new Date().toISOString();

    const sql = `
      INSERT INTO badge_jobs (id, template_id, uid, badge_name, badge_image, status, created_at, retry_count)
      VALUES (?, ?, ?, ?, ?, 'queued', ?, 0)
    `;

    await this.connection.run(sql, [id, templateId, uid, badgeName, badgeImage, createdAt]);
    
    return await this.findById(id);
  }

  // Find badge job by ID
  async findById(id) {
    const sql = 'SELECT * FROM badge_jobs WHERE id = ?';
    const row = await this.connection.get(sql, [id]);
    
    if (!row) {
      return null;
    }

    return this.mapRowToJob(row);
  }

  // Find all badge jobs with optional status filter
  async findAll(status = null) {
    let sql = 'SELECT * FROM badge_jobs';
    let params = [];

    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at ASC';

    const rows = await this.connection.all(sql, params);
    return rows.map(row => this.mapRowToJob(row));
  }

  // Update badge job status
  async updateStatus(id, status, errorMessage = null) {
    const validStatuses = ['queued', 'processing', 'completed', 'failed'];
    
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
    }

    let sql = 'UPDATE badge_jobs SET status = ?';
    let params = [status, id];

    if (status === 'completed' || status === 'failed') {
      sql += ', processed_at = ?';
      params.splice(1, 0, new Date().toISOString());
    }

    if (errorMessage) {
      sql += ', error_message = ?';
      params.splice(-1, 0, errorMessage);
    }

    sql += ' WHERE id = ?';

    const result = await this.connection.run(sql, params);
    
    if (result.changes === 0) {
      throw new Error(`Badge job with ID ${id} not found`);
    }

    return await this.findById(id);
  }

  // Increment retry count
  async incrementRetryCount(id) {
    const sql = 'UPDATE badge_jobs SET retry_count = retry_count + 1 WHERE id = ?';
    const result = await this.connection.run(sql, [id]);
    
    if (result.changes === 0) {
      throw new Error(`Badge job with ID ${id} not found`);
    }

    return await this.findById(id);
  }

  // Delete badge job
  async delete(id) {
    const sql = 'DELETE FROM badge_jobs WHERE id = ?';
    const result = await this.connection.run(sql, [id]);
    
    if (result.changes === 0) {
      throw new Error(`Badge job with ID ${id} not found`);
    }

    return true;
  }

  // Get queue statistics
  async getQueueStats() {
    const sql = `
      SELECT 
        status,
        COUNT(*) as count
      FROM badge_jobs 
      WHERE status IN ('queued', 'processing')
      GROUP BY status
    `;

    const rows = await this.connection.all(sql);
    
    const stats = {
      queued: 0,
      processing: 0,
      total: 0
    };

    rows.forEach(row => {
      stats[row.status] = row.count;
      stats.total += row.count;
    });

    return stats;
  }

  // Get next job in queue
  async getNextInQueue() {
    const sql = `
      SELECT * FROM badge_jobs 
      WHERE status = 'queued' 
      ORDER BY created_at ASC 
      LIMIT 1
    `;

    const row = await this.connection.get(sql);
    return row ? this.mapRowToJob(row) : null;
  }

  // Check if UID is unique in active jobs
  async isUidUnique(uid, excludeJobId = null) {
    let sql = 'SELECT id FROM badge_jobs WHERE uid = ? AND status IN (?, ?)';
    let params = [uid, 'queued', 'processing'];

    if (excludeJobId) {
      sql += ' AND id != ?';
      params.push(excludeJobId);
    }

    const row = await this.connection.get(sql, params);
    return !row;
  }

  // Map database row to job object
  mapRowToJob(row) {
    return {
      id: row.id,
      templateId: row.template_id,
      uid: row.uid,
      badgeName: row.badge_name,
      badgeImage: row.badge_image,
      status: row.status,
      createdAt: new Date(row.created_at),
      processedAt: row.processed_at ? new Date(row.processed_at) : null,
      retryCount: row.retry_count,
      errorMessage: row.error_message
    };
  }
}

module.exports = BadgeJob;