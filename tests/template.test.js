const DatabaseSchema = require('../server/database/schema');
const Template = require('../server/models/Template');
const fs = require('fs');
const path = require('path');

describe('Template Model', () => {
  let schema;
  let template;
  let testFilePath;

  beforeEach(async () => {
    schema = new DatabaseSchema();
    schema.connection.dbPath = ':memory:';
    await schema.initialize();
    template = new Template(schema.connection);

    // Create a test template file
    testFilePath = path.join(__dirname, '../data/test_template.indd');
    const testDir = path.dirname(testFilePath);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    fs.writeFileSync(testFilePath, 'test template content');
  });

  afterEach(async () => {
    await schema.close();
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  const validTextFields = {
    uid: {
      x: 100,
      y: 200,
      fontSize: 12,
      fontFamily: 'Arial'
    },
    badgeName: {
      x: 100,
      y: 250,
      fontSize: 16,
      fontFamily: 'Arial Bold'
    }
  };

  describe('create', () => {
    test('should create a new template successfully', async () => {
      const templateData = {
        name: 'Standard Badge',
        filePath: testFilePath,
        previewPath: '/path/to/preview.png',
        textFields: validTextFields,
        printerPresets: 'standard'
      };

      const createdTemplate = await template.create(templateData);
      
      expect(createdTemplate).toHaveProperty('id');
      expect(createdTemplate.name).toBe(templateData.name);
      expect(createdTemplate.filePath).toBe(templateData.filePath);
      expect(createdTemplate.textFields).toEqual(templateData.textFields);
      expect(createdTemplate.printerPresets).toBe(templateData.printerPresets);
      expect(createdTemplate.createdAt).toBeInstanceOf(Date);
    });

    test('should throw error for missing required fields', async () => {
      const incompleteData = {
        name: 'Standard Badge',
        filePath: testFilePath
        // missing textFields
      };

      await expect(template.create(incompleteData)).rejects.toThrow('Missing required fields');
    });

    test('should throw error for non-existent file', async () => {
      const templateData = {
        name: 'Standard Badge',
        filePath: '/non/existent/file.indd',
        textFields: validTextFields
      };

      await expect(template.create(templateData)).rejects.toThrow('Template file does not exist');
    });

    test('should throw error for duplicate template name', async () => {
      const templateData = {
        name: 'Standard Badge',
        filePath: testFilePath,
        textFields: validTextFields
      };

      await template.create(templateData);
      
      await expect(template.create(templateData)).rejects.toThrow('Template with name \'Standard Badge\' already exists');
    });

    test('should throw error for invalid text fields', async () => {
      const templateData = {
        name: 'Standard Badge',
        filePath: testFilePath,
        textFields: {
          uid: {
            x: 100,
            y: 200
            // missing fontSize and fontFamily
          }
        }
      };

      await expect(template.create(templateData)).rejects.toThrow('textFields.uid must contain \'fontSize\' property');
    });
  });

  describe('findById', () => {
    test('should find template by ID', async () => {
      const templateData = {
        name: 'Standard Badge',
        filePath: testFilePath,
        textFields: validTextFields
      };

      const createdTemplate = await template.create(templateData);
      const foundTemplate = await template.findById(createdTemplate.id);
      
      expect(foundTemplate).toEqual(createdTemplate);
    });

    test('should return null for non-existent ID', async () => {
      const foundTemplate = await template.findById('non-existent-id');
      expect(foundTemplate).toBeNull();
    });
  });

  describe('findByName', () => {
    test('should find template by name', async () => {
      const templateData = {
        name: 'Standard Badge',
        filePath: testFilePath,
        textFields: validTextFields
      };

      const createdTemplate = await template.create(templateData);
      const foundTemplate = await template.findByName('Standard Badge');
      
      expect(foundTemplate).toEqual(createdTemplate);
    });

    test('should return null for non-existent name', async () => {
      const foundTemplate = await template.findByName('Non-existent Template');
      expect(foundTemplate).toBeNull();
    });
  });

  describe('findAll', () => {
    test('should return all templates', async () => {
      const templateData1 = {
        name: 'Standard Badge',
        filePath: testFilePath,
        textFields: validTextFields
      };

      const templateData2 = {
        name: 'VIP Badge',
        filePath: testFilePath,
        textFields: validTextFields
      };

      await template.create(templateData1);
      await template.create(templateData2);

      const templates = await template.findAll();
      expect(templates).toHaveLength(2);
      expect(templates.map(t => t.name)).toContain('Standard Badge');
      expect(templates.map(t => t.name)).toContain('VIP Badge');
    });
  });

  describe('update', () => {
    test('should update template successfully', async () => {
      const templateData = {
        name: 'Standard Badge',
        filePath: testFilePath,
        textFields: validTextFields
      };

      const createdTemplate = await template.create(templateData);
      
      const updateData = {
        name: 'Updated Badge',
        printerPresets: 'high-quality'
      };

      const updatedTemplate = await template.update(createdTemplate.id, updateData);
      
      expect(updatedTemplate.name).toBe('Updated Badge');
      expect(updatedTemplate.printerPresets).toBe('high-quality');
      expect(updatedTemplate.updatedAt.getTime()).toBeGreaterThanOrEqual(updatedTemplate.createdAt.getTime());
    });

    test('should throw error for non-existent template', async () => {
      await expect(template.update('non-existent-id', { name: 'New Name' })).rejects.toThrow('not found');
    });

    test('should throw error for duplicate name', async () => {
      const templateData1 = {
        name: 'Standard Badge',
        filePath: testFilePath,
        textFields: validTextFields
      };

      const templateData2 = {
        name: 'VIP Badge',
        filePath: testFilePath,
        textFields: validTextFields
      };

      await template.create(templateData1);
      const template2 = await template.create(templateData2);

      await expect(template.update(template2.id, { name: 'Standard Badge' })).rejects.toThrow('already exists');
    });
  });

  describe('delete', () => {
    test('should delete template successfully', async () => {
      const templateData = {
        name: 'Standard Badge',
        filePath: testFilePath,
        textFields: validTextFields
      };

      const createdTemplate = await template.create(templateData);
      const result = await template.delete(createdTemplate.id);
      
      expect(result).toBe(true);
      
      const deletedTemplate = await template.findById(createdTemplate.id);
      expect(deletedTemplate).toBeNull();
    });

    test('should throw error for non-existent template', async () => {
      await expect(template.delete('non-existent-id')).rejects.toThrow('not found');
    });
  });

  describe('validateTemplateFile', () => {
    test('should validate existing template file', async () => {
      const templateData = {
        name: 'Standard Badge',
        filePath: testFilePath,
        textFields: validTextFields
      };

      const createdTemplate = await template.create(templateData);
      
      await expect(template.validateTemplateFile(createdTemplate.id)).resolves.toBe(true);
    });

    test('should throw error for missing template file', async () => {
      const templateData = {
        name: 'Standard Badge',
        filePath: testFilePath,
        textFields: validTextFields
      };

      const createdTemplate = await template.create(templateData);
      
      // Remove the file
      fs.unlinkSync(testFilePath);
      
      await expect(template.validateTemplateFile(createdTemplate.id)).rejects.toThrow('does not exist');
    });
  });

  describe('validateTextFields', () => {
    test('should validate correct text fields', () => {
      expect(() => template.validateTextFields(validTextFields)).not.toThrow();
    });

    test('should throw error for missing required fields', () => {
      const invalidTextFields = {
        uid: validTextFields.uid
        // missing badgeName
      };

      expect(() => template.validateTextFields(invalidTextFields)).toThrow('must contain \'badgeName\' configuration');
    });

    test('should throw error for missing properties', () => {
      const invalidTextFields = {
        uid: {
          x: 100,
          y: 200
          // missing fontSize and fontFamily
        },
        badgeName: validTextFields.badgeName
      };

      expect(() => template.validateTextFields(invalidTextFields)).toThrow('must contain \'fontSize\' property');
    });

    test('should throw error for invalid property types', () => {
      const invalidTextFields = {
        uid: {
          x: '100', // should be number
          y: 200,
          fontSize: 12,
          fontFamily: 'Arial'
        },
        badgeName: validTextFields.badgeName
      };

      expect(() => template.validateTextFields(invalidTextFields)).toThrow('must be numbers');
    });

    test('should throw error for empty font family', () => {
      const invalidTextFields = {
        uid: {
          x: 100,
          y: 200,
          fontSize: 12,
          fontFamily: '' // empty string
        },
        badgeName: validTextFields.badgeName
      };

      expect(() => template.validateTextFields(invalidTextFields)).toThrow('must be a non-empty string');
    });
  });
});