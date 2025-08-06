const DatabaseSchema = require('../server/database/schema');
const PrinterConfiguration = require('../server/models/PrinterConfiguration');
const path = require('path');

describe('PrinterConfiguration Model', () => {
  let schema;
  let printerConfig;

  beforeEach(async () => {
    schema = new DatabaseSchema();
    schema.connection.dbPath = ':memory:';
    await schema.initialize();
    printerConfig = new PrinterConfiguration(schema.connection);
  });

  afterEach(async () => {
    await schema.close();
  });

  const validPresets = {
    standard: {
      paperSize: 'A4',
      quality: 'normal',
      orientation: 'portrait',
      margins: {
        top: 10,
        right: 10,
        bottom: 10,
        left: 10
      }
    },
    highQuality: {
      paperSize: 'A4',
      quality: 'high',
      orientation: 'landscape'
    }
  };

  describe('create', () => {
    test('should create a new printer configuration successfully', async () => {
      const configData = {
        name: 'Canon Printer',
        isConnected: true,
        presets: validPresets
      };

      const config = await printerConfig.create(configData);
      
      expect(config).toHaveProperty('id');
      expect(config.name).toBe(configData.name);
      expect(config.isConnected).toBe(true);
      expect(config.presets).toEqual(configData.presets);
      expect(config.createdAt).toBeInstanceOf(Date);
    });

    test('should create with default isConnected false', async () => {
      const configData = {
        name: 'Canon Printer',
        presets: validPresets
      };

      const config = await printerConfig.create(configData);
      expect(config.isConnected).toBe(false);
    });

    test('should throw error for missing required fields', async () => {
      const incompleteData = {
        name: 'Canon Printer'
        // missing presets
      };

      await expect(printerConfig.create(incompleteData)).rejects.toThrow('Missing required fields');
    });

    test('should throw error for duplicate printer name', async () => {
      const configData = {
        name: 'Canon Printer',
        presets: validPresets
      };

      await printerConfig.create(configData);
      
      await expect(printerConfig.create(configData)).rejects.toThrow('already exists');
    });

    test('should throw error for invalid presets', async () => {
      const configData = {
        name: 'Canon Printer',
        presets: {
          invalid: {
            paperSize: 'A4'
            // missing required fields
          }
        }
      };

      await expect(printerConfig.create(configData)).rejects.toThrow('must contain \'quality\'');
    });
  });

  describe('findById', () => {
    test('should find printer configuration by ID', async () => {
      const configData = {
        name: 'Canon Printer',
        presets: validPresets
      };

      const createdConfig = await printerConfig.create(configData);
      const foundConfig = await printerConfig.findById(createdConfig.id);
      
      expect(foundConfig).toEqual(createdConfig);
    });

    test('should return null for non-existent ID', async () => {
      const config = await printerConfig.findById('non-existent-id');
      expect(config).toBeNull();
    });
  });

  describe('findByName', () => {
    test('should find printer configuration by name', async () => {
      const configData = {
        name: 'Canon Printer',
        presets: validPresets
      };

      const createdConfig = await printerConfig.create(configData);
      const foundConfig = await printerConfig.findByName('Canon Printer');
      
      expect(foundConfig).toEqual(createdConfig);
    });

    test('should return null for non-existent name', async () => {
      const config = await printerConfig.findByName('Non-existent Printer');
      expect(config).toBeNull();
    });
  });

  describe('findAll', () => {
    test('should return all printer configurations', async () => {
      const configData1 = {
        name: 'Canon Printer',
        presets: validPresets
      };

      const configData2 = {
        name: 'HP Printer',
        presets: validPresets
      };

      await printerConfig.create(configData1);
      await printerConfig.create(configData2);

      const configs = await printerConfig.findAll();
      expect(configs).toHaveLength(2);
      expect(configs.map(c => c.name)).toContain('Canon Printer');
      expect(configs.map(c => c.name)).toContain('HP Printer');
    });
  });

  describe('findConnected', () => {
    test('should return only connected printers', async () => {
      const configData1 = {
        name: 'Canon Printer',
        isConnected: true,
        presets: validPresets
      };

      const configData2 = {
        name: 'HP Printer',
        isConnected: false,
        presets: validPresets
      };

      await printerConfig.create(configData1);
      await printerConfig.create(configData2);

      const connectedConfigs = await printerConfig.findConnected();
      expect(connectedConfigs).toHaveLength(1);
      expect(connectedConfigs[0].name).toBe('Canon Printer');
    });
  });

  describe('update', () => {
    test('should update printer configuration successfully', async () => {
      const configData = {
        name: 'Canon Printer',
        presets: validPresets
      };

      const createdConfig = await printerConfig.create(configData);
      
      const updateData = {
        name: 'Updated Canon Printer',
        isConnected: true
      };

      const updatedConfig = await printerConfig.update(createdConfig.id, updateData);
      
      expect(updatedConfig.name).toBe('Updated Canon Printer');
      expect(updatedConfig.isConnected).toBe(true);
      expect(updatedConfig.updatedAt.getTime()).toBeGreaterThanOrEqual(updatedConfig.createdAt.getTime());
    });

    test('should throw error for non-existent configuration', async () => {
      await expect(printerConfig.update('non-existent-id', { name: 'New Name' })).rejects.toThrow('not found');
    });

    test('should throw error for duplicate name', async () => {
      const configData1 = {
        name: 'Canon Printer',
        presets: validPresets
      };

      const configData2 = {
        name: 'HP Printer',
        presets: validPresets
      };

      await printerConfig.create(configData1);
      const config2 = await printerConfig.create(configData2);

      await expect(printerConfig.update(config2.id, { name: 'Canon Printer' })).rejects.toThrow('already exists');
    });
  });

  describe('updateConnectionStatus', () => {
    test('should update connection status', async () => {
      const configData = {
        name: 'Canon Printer',
        presets: validPresets
      };

      const createdConfig = await printerConfig.create(configData);
      const updatedConfig = await printerConfig.updateConnectionStatus(createdConfig.id, true);
      
      expect(updatedConfig.isConnected).toBe(true);
    });
  });

  describe('delete', () => {
    test('should delete printer configuration successfully', async () => {
      const configData = {
        name: 'Canon Printer',
        presets: validPresets
      };

      const createdConfig = await printerConfig.create(configData);
      const result = await printerConfig.delete(createdConfig.id);
      
      expect(result).toBe(true);
      
      const deletedConfig = await printerConfig.findById(createdConfig.id);
      expect(deletedConfig).toBeNull();
    });

    test('should throw error for non-existent configuration', async () => {
      await expect(printerConfig.delete('non-existent-id')).rejects.toThrow('not found');
    });
  });

  describe('getPreset', () => {
    test('should get preset by name', async () => {
      const configData = {
        name: 'Canon Printer',
        presets: validPresets
      };

      const createdConfig = await printerConfig.create(configData);
      const preset = await printerConfig.getPreset(createdConfig.id, 'standard');
      
      expect(preset).toEqual(validPresets.standard);
    });

    test('should throw error for non-existent preset', async () => {
      const configData = {
        name: 'Canon Printer',
        presets: validPresets
      };

      const createdConfig = await printerConfig.create(configData);
      
      await expect(printerConfig.getPreset(createdConfig.id, 'nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('updatePreset', () => {
    test('should update existing preset', async () => {
      const configData = {
        name: 'Canon Printer',
        presets: validPresets
      };

      const createdConfig = await printerConfig.create(configData);
      
      const newPresetConfig = {
        paperSize: 'Letter',
        quality: 'draft',
        orientation: 'portrait'
      };

      const updatedConfig = await printerConfig.updatePreset(createdConfig.id, 'standard', newPresetConfig);
      
      expect(updatedConfig.presets.standard).toEqual(newPresetConfig);
    });

    test('should add new preset', async () => {
      const configData = {
        name: 'Canon Printer',
        presets: validPresets
      };

      const createdConfig = await printerConfig.create(configData);
      
      const newPresetConfig = {
        paperSize: 'Letter',
        quality: 'draft',
        orientation: 'portrait'
      };

      const updatedConfig = await printerConfig.updatePreset(createdConfig.id, 'draft', newPresetConfig);
      
      expect(updatedConfig.presets.draft).toEqual(newPresetConfig);
      expect(Object.keys(updatedConfig.presets)).toHaveLength(3);
    });
  });

  describe('removePreset', () => {
    test('should remove preset successfully', async () => {
      const configData = {
        name: 'Canon Printer',
        presets: validPresets
      };

      const createdConfig = await printerConfig.create(configData);
      const updatedConfig = await printerConfig.removePreset(createdConfig.id, 'standard');
      
      expect(updatedConfig.presets.standard).toBeUndefined();
      expect(Object.keys(updatedConfig.presets)).toHaveLength(1);
    });

    test('should throw error for non-existent preset', async () => {
      const configData = {
        name: 'Canon Printer',
        presets: validPresets
      };

      const createdConfig = await printerConfig.create(configData);
      
      await expect(printerConfig.removePreset(createdConfig.id, 'nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('validatePresets', () => {
    test('should validate correct presets', () => {
      expect(() => printerConfig.validatePresets(validPresets)).not.toThrow();
    });

    test('should throw error for empty presets', () => {
      expect(() => printerConfig.validatePresets({})).toThrow('must contain at least one preset');
    });

    test('should throw error for invalid preset structure', () => {
      const invalidPresets = {
        invalid: {
          paperSize: 'A4'
          // missing required fields
        }
      };

      expect(() => printerConfig.validatePresets(invalidPresets)).toThrow('must contain \'quality\'');
    });

    test('should throw error for invalid orientation', () => {
      const invalidPresets = {
        invalid: {
          paperSize: 'A4',
          quality: 'normal',
          orientation: 'invalid'
        }
      };

      expect(() => printerConfig.validatePresets(invalidPresets)).toThrow('orientation must be one of');
    });

    test('should throw error for invalid margins', () => {
      const invalidPresets = {
        invalid: {
          paperSize: 'A4',
          quality: 'normal',
          orientation: 'portrait',
          margins: {
            top: 'invalid' // should be number
          }
        }
      };

      expect(() => printerConfig.validatePresets(invalidPresets)).toThrow('must be a number');
    });
  });
});