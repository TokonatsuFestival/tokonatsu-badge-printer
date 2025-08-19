const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

class Template {
  constructor(connection) {
    this.connection = connection;
  }

  // Create a new template
  async create(templateData) {
    const { name, filePath, previewPath, textFields, printerPresets } = templateData;
    
    // Validate required fields
    if (!name || !filePath || !textFields) {
      throw new Error('Missing required fields: name, filePath, and textFields are required');
    }

    // Validate text fields structure
    this.validateTextFields(textFields);

    // Validate file exists (skip for internal templates)
    if (!filePath.startsWith('internal://') && !fs.existsSync(filePath)) {
      throw new Error(`Template file does not exist: ${filePath}`);
    }

    // Check if template name already exists
    const existingTemplate = await this.connection.get(
      'SELECT id FROM templates WHERE name = ?',
      [name]
    );

    if (existingTemplate) {
      throw new Error(`Template with name '${name}' already exists`);
    }

    const id = uuidv4();
    const createdAt = new Date().toISOString();

    const sql = `
      INSERT INTO templates (id, name, file_path, preview_path, text_fields, printer_presets, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.connection.run(sql, [
      id, 
      name, 
      filePath, 
      previewPath || null,
      JSON.stringify(textFields),
      printerPresets || null,
      createdAt,
      createdAt
    ]);
    
    return await this.findById(id);
  }

  // Find template by ID
  async findById(id) {
    const sql = 'SELECT * FROM templates WHERE id = ?';
    const row = await this.connection.get(sql, [id]);
    
    if (!row) {
      return null;
    }

    return this.mapRowToTemplate(row);
  }

  // Find template by name
  async findByName(name) {
    const sql = 'SELECT * FROM templates WHERE name = ?';
    const row = await this.connection.get(sql, [name]);
    
    if (!row) {
      return null;
    }

    return this.mapRowToTemplate(row);
  }

  // Find all templates
  async findAll() {
    const sql = 'SELECT * FROM templates ORDER BY name ASC';
    const rows = await this.connection.all(sql);
    return rows.map(row => this.mapRowToTemplate(row));
  }

  // Update template
  async update(id, updateData) {
    const template = await this.findById(id);
    if (!template) {
      throw new Error(`Template with ID ${id} not found`);
    }

    const allowedFields = ['name', 'filePath', 'previewPath', 'textFields', 'printerPresets'];
    const updates = [];
    const params = [];

    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key) && updateData[key] !== undefined) {
        if (key === 'textFields') {
          this.validateTextFields(updateData[key]);
          updates.push(`${this.camelToSnake(key)} = ?`);
          params.push(JSON.stringify(updateData[key]));
        } else if (key === 'filePath' && updateData[key]) {
          // Validate file exists (skip for internal templates)
          if (!updateData[key].startsWith('internal://') && !fs.existsSync(updateData[key])) {
            throw new Error(`Template file does not exist: ${updateData[key]}`);
          }
          updates.push(`${this.camelToSnake(key)} = ?`);
          params.push(updateData[key]);
        } else {
          updates.push(`${this.camelToSnake(key)} = ?`);
          params.push(updateData[key]);
        }
      }
    });

    if (updates.length === 0) {
      throw new Error('No valid fields to update');
    }

    // Check name uniqueness if name is being updated
    if (updateData.name && updateData.name !== template.name) {
      const existingTemplate = await this.connection.get(
        'SELECT id FROM templates WHERE name = ? AND id != ?',
        [updateData.name, id]
      );

      if (existingTemplate) {
        throw new Error(`Template with name '${updateData.name}' already exists`);
      }
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    const sql = `UPDATE templates SET ${updates.join(', ')} WHERE id = ?`;
    const result = await this.connection.run(sql, params);
    
    if (result.changes === 0) {
      throw new Error(`Template with ID ${id} not found`);
    }

    return await this.findById(id);
  }

  // Delete template
  async delete(id) {
    // Check if template is being used by any active jobs
    const activeJobs = await this.connection.get(
      'SELECT id FROM badge_jobs WHERE template_id = ? AND status IN (?, ?)',
      [id, 'queued', 'processing']
    );

    if (activeJobs) {
      throw new Error('Cannot delete template that is being used by active jobs');
    }

    const sql = 'DELETE FROM templates WHERE id = ?';
    const result = await this.connection.run(sql, [id]);
    
    if (result.changes === 0) {
      throw new Error(`Template with ID ${id} not found`);
    }

    return true;
  }

  // Validate template file exists and is accessible
  async validateTemplateFile(id) {
    const template = await this.findById(id);
    if (!template) {
      throw new Error(`Template with ID ${id} not found`);
    }

    // Handle internal templates
    if (template.filePath && template.filePath.startsWith('internal://')) {
      return true; // Internal templates don't require file validation
    }

    if (!fs.existsSync(template.filePath)) {
      throw new Error(`Template file does not exist: ${template.filePath}`);
    }

    // Check if file is readable
    try {
      fs.accessSync(template.filePath, fs.constants.R_OK);
      return true;
    } catch (error) {
      throw new Error(`Template file is not readable: ${template.filePath}`);
    }
  }

  // Get templates with their usage statistics
  async getTemplatesWithStats() {
    const sql = `
      SELECT 
        t.*,
        COUNT(bj.id) as total_jobs,
        COUNT(CASE WHEN bj.status = 'completed' THEN 1 END) as completed_jobs,
        COUNT(CASE WHEN bj.status = 'failed' THEN 1 END) as failed_jobs
      FROM templates t
      LEFT JOIN badge_jobs bj ON t.id = bj.template_id
      GROUP BY t.id
      ORDER BY t.name ASC
    `;

    const rows = await this.connection.all(sql);
    return rows.map(row => ({
      ...this.mapRowToTemplate(row),
      stats: {
        totalJobs: row.total_jobs,
        completedJobs: row.completed_jobs,
        failedJobs: row.failed_jobs
      }
    }));
  }

  // Validate text fields structure
  validateTextFields(textFields) {
    if (!textFields || typeof textFields !== 'object') {
      throw new Error('textFields must be an object');
    }

    const requiredFields = ['uid', 'badgeName'];
    const requiredProperties = ['x', 'y', 'fontSize', 'fontFamily'];

    requiredFields.forEach(field => {
      if (!textFields[field]) {
        throw new Error(`textFields must contain '${field}' configuration`);
      }

      const fieldConfig = textFields[field];
      requiredProperties.forEach(prop => {
        if (fieldConfig[prop] === undefined || fieldConfig[prop] === null) {
          throw new Error(`textFields.${field} must contain '${prop}' property`);
        }
      });

      // Validate numeric properties
      if (typeof fieldConfig.x !== 'number' || typeof fieldConfig.y !== 'number' || typeof fieldConfig.fontSize !== 'number') {
        throw new Error(`textFields.${field} x, y, and fontSize must be numbers`);
      }

      // Validate string properties
      if (typeof fieldConfig.fontFamily !== 'string' || fieldConfig.fontFamily.trim() === '') {
        throw new Error(`textFields.${field} fontFamily must be a non-empty string`);
      }
    });
  }

  // Convert camelCase to snake_case
  camelToSnake(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  // Map database row to template object
  mapRowToTemplate(row) {
    return {
      id: row.id,
      name: row.name,
      filePath: row.file_path,
      previewPath: row.preview_path,
      textFields: JSON.parse(row.text_fields),
      printerPresets: row.printer_presets,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}

module.exports = Template;