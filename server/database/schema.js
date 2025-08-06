const DatabaseConnection = require('./connection');

class DatabaseSchema {
  constructor() {
    this.connection = new DatabaseConnection();
  }

  async initialize() {
    try {
      await this.connection.connect();
      await this.createTables();
      console.log('Database schema initialized successfully');
    } catch (error) {
      console.error('Error initializing database schema:', error);
      throw error;
    }
  }

  async createTables() {
    // Create badge_jobs table
    const createBadgeJobsTable = `
      CREATE TABLE IF NOT EXISTS badge_jobs (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        uid TEXT NOT NULL,
        badge_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME,
        retry_count INTEGER DEFAULT 0,
        error_message TEXT,
        FOREIGN KEY (template_id) REFERENCES templates (id)
      )
    `;

    // Create templates table
    const createTemplatesTable = `
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        preview_path TEXT,
        text_fields TEXT NOT NULL,
        printer_presets TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create printer_configurations table
    const createPrinterConfigsTable = `
      CREATE TABLE IF NOT EXISTS printer_configurations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        is_connected BOOLEAN DEFAULT FALSE,
        presets TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create indexes for better performance
    const createIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_badge_jobs_status ON badge_jobs(status)',
      'CREATE INDEX IF NOT EXISTS idx_badge_jobs_created_at ON badge_jobs(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_badge_jobs_uid ON badge_jobs(uid)',
      'CREATE INDEX IF NOT EXISTS idx_templates_name ON templates(name)',
      'CREATE INDEX IF NOT EXISTS idx_printer_configs_name ON printer_configurations(name)'
    ];

    // Execute table creation
    await this.connection.run(createBadgeJobsTable);
    await this.connection.run(createTemplatesTable);
    await this.connection.run(createPrinterConfigsTable);

    // Execute index creation
    for (const indexSql of createIndexes) {
      await this.connection.run(indexSql);
    }
  }

  async close() {
    await this.connection.close();
  }

  getConnection() {
    return this.connection;
  }
}

module.exports = DatabaseSchema;