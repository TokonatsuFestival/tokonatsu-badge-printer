const { v4: uuidv4 } = require('uuid');

class PrinterConfiguration {
  constructor(connection) {
    this.connection = connection;
  }

  // Create a new printer configuration
  async create(configData) {
    const { name, isConnected = false, presets } = configData;
    
    // Validate required fields
    if (!name || !presets) {
      throw new Error('Missing required fields: name and presets are required');
    }

    // Validate presets structure
    this.validatePresets(presets);

    // Check if printer name already exists
    const existingConfig = await this.connection.get(
      'SELECT id FROM printer_configurations WHERE name = ?',
      [name]
    );

    if (existingConfig) {
      throw new Error(`Printer configuration with name '${name}' already exists`);
    }

    const id = uuidv4();
    const createdAt = new Date().toISOString();

    const sql = `
      INSERT INTO printer_configurations (id, name, is_connected, presets, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    await this.connection.run(sql, [
      id, 
      name, 
      isConnected,
      JSON.stringify(presets),
      createdAt,
      createdAt
    ]);
    
    return await this.findById(id);
  }

  // Find printer configuration by ID
  async findById(id) {
    const sql = 'SELECT * FROM printer_configurations WHERE id = ?';
    const row = await this.connection.get(sql, [id]);
    
    if (!row) {
      return null;
    }

    return this.mapRowToConfig(row);
  }

  // Find printer configuration by name
  async findByName(name) {
    const sql = 'SELECT * FROM printer_configurations WHERE name = ?';
    const row = await this.connection.get(sql, [name]);
    
    if (!row) {
      return null;
    }

    return this.mapRowToConfig(row);
  }

  // Find all printer configurations
  async findAll() {
    const sql = 'SELECT * FROM printer_configurations ORDER BY name ASC';
    const rows = await this.connection.all(sql);
    return rows.map(row => this.mapRowToConfig(row));
  }

  // Find connected printers
  async findConnected() {
    const sql = 'SELECT * FROM printer_configurations WHERE is_connected = TRUE ORDER BY name ASC';
    const rows = await this.connection.all(sql);
    return rows.map(row => this.mapRowToConfig(row));
  }

  // Update printer configuration
  async update(id, updateData) {
    const config = await this.findById(id);
    if (!config) {
      throw new Error(`Printer configuration with ID ${id} not found`);
    }

    const allowedFields = ['name', 'isConnected', 'presets'];
    const updates = [];
    const params = [];

    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key) && updateData[key] !== undefined) {
        if (key === 'presets') {
          this.validatePresets(updateData[key]);
          updates.push('presets = ?');
          params.push(JSON.stringify(updateData[key]));
        } else if (key === 'isConnected') {
          updates.push('is_connected = ?');
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
    if (updateData.name && updateData.name !== config.name) {
      const existingConfig = await this.connection.get(
        'SELECT id FROM printer_configurations WHERE name = ? AND id != ?',
        [updateData.name, id]
      );

      if (existingConfig) {
        throw new Error(`Printer configuration with name '${updateData.name}' already exists`);
      }
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    const sql = `UPDATE printer_configurations SET ${updates.join(', ')} WHERE id = ?`;
    const result = await this.connection.run(sql, params);
    
    if (result.changes === 0) {
      throw new Error(`Printer configuration with ID ${id} not found`);
    }

    return await this.findById(id);
  }

  // Update connection status
  async updateConnectionStatus(id, isConnected) {
    const sql = 'UPDATE printer_configurations SET is_connected = ?, updated_at = ? WHERE id = ?';
    const result = await this.connection.run(sql, [isConnected, new Date().toISOString(), id]);
    
    if (result.changes === 0) {
      throw new Error(`Printer configuration with ID ${id} not found`);
    }

    return await this.findById(id);
  }

  // Delete printer configuration
  async delete(id) {
    const sql = 'DELETE FROM printer_configurations WHERE id = ?';
    const result = await this.connection.run(sql, [id]);
    
    if (result.changes === 0) {
      throw new Error(`Printer configuration with ID ${id} not found`);
    }

    return true;
  }

  // Get preset by name for a specific printer
  async getPreset(printerId, presetName) {
    const config = await this.findById(printerId);
    if (!config) {
      throw new Error(`Printer configuration with ID ${printerId} not found`);
    }

    if (!config.presets[presetName]) {
      throw new Error(`Preset '${presetName}' not found for printer '${config.name}'`);
    }

    return config.presets[presetName];
  }

  // Add or update a preset for a printer
  async updatePreset(printerId, presetName, presetConfig) {
    const config = await this.findById(printerId);
    if (!config) {
      throw new Error(`Printer configuration with ID ${printerId} not found`);
    }

    // Validate preset configuration
    this.validatePresetConfig(presetConfig);

    const updatedPresets = { ...config.presets };
    updatedPresets[presetName] = presetConfig;

    return await this.update(printerId, { presets: updatedPresets });
  }

  // Remove a preset from a printer
  async removePreset(printerId, presetName) {
    const config = await this.findById(printerId);
    if (!config) {
      throw new Error(`Printer configuration with ID ${printerId} not found`);
    }

    if (!config.presets[presetName]) {
      throw new Error(`Preset '${presetName}' not found for printer '${config.name}'`);
    }

    const updatedPresets = { ...config.presets };
    delete updatedPresets[presetName];

    return await this.update(printerId, { presets: updatedPresets });
  }

  // Validate presets structure
  validatePresets(presets) {
    if (!presets || typeof presets !== 'object') {
      throw new Error('presets must be an object');
    }

    if (Object.keys(presets).length === 0) {
      throw new Error('presets must contain at least one preset configuration');
    }

    Object.keys(presets).forEach(presetName => {
      this.validatePresetConfig(presets[presetName], presetName);
    });
  }

  // Validate individual preset configuration
  validatePresetConfig(presetConfig, presetName = 'preset') {
    if (!presetConfig || typeof presetConfig !== 'object') {
      throw new Error(`${presetName} configuration must be an object`);
    }

    const requiredProperties = ['paperSize', 'quality', 'orientation'];
    requiredProperties.forEach(prop => {
      if (!presetConfig[prop] || typeof presetConfig[prop] !== 'string') {
        throw new Error(`${presetName} must contain '${prop}' as a non-empty string`);
      }
    });

    // Validate orientation values
    const validOrientations = ['portrait', 'landscape'];
    if (!validOrientations.includes(presetConfig.orientation)) {
      throw new Error(`${presetName} orientation must be one of: ${validOrientations.join(', ')}`);
    }

    // Validate margins if provided
    if (presetConfig.margins) {
      if (typeof presetConfig.margins !== 'object') {
        throw new Error(`${presetName} margins must be an object`);
      }

      const marginProps = ['top', 'right', 'bottom', 'left'];
      marginProps.forEach(prop => {
        if (presetConfig.margins[prop] !== undefined && typeof presetConfig.margins[prop] !== 'number') {
          throw new Error(`${presetName} margins.${prop} must be a number`);
        }
      });
    }
  }

  // Convert camelCase to snake_case
  camelToSnake(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  // Map database row to configuration object
  mapRowToConfig(row) {
    return {
      id: row.id,
      name: row.name,
      isConnected: Boolean(row.is_connected),
      presets: JSON.parse(row.presets),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}

module.exports = PrinterConfiguration;