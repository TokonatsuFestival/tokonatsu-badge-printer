const TemplateProcessor = require('../server/services/TemplateProcessor');
const DatabaseSchema = require('../server/database/schema');
const Template = require('../server/models/Template');
const fs = require('fs');
const path = require('path');

describe('TemplateProcessor', () => {
  let templateProcessor;
  let schema;
  let templateModel;
  let testFilePath;
  let testTemplate;

  beforeEach(async () => {
    templateProcessor = new TemplateProcessor();
    
    // Set up database
    schema = new DatabaseSchema();
    schema.connection.dbPath = ':memory:';
    await schema.initialize();
    templateModel = new Template(schema.connection);

    // Create test template file
    testFilePath = path.join(__dirname, '../data/test_template.indd');
    const testDir = path.dirname(testFilePath);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    fs.writeFileSync(testFilePath, 'test template content');

    // Create test template in database
    const templateData = {
      name: 'Test Badge',
      filePath: testFilePath,
      textFields: {
        uid: {
          x: 50,
          y: 100,
          fontSize: 14,
          fontFamily: 'Arial'
        },
        badgeName: {
          x: 50,
          y: 150,
          fontSize: 18,
          fontFamily: 'Arial Bold'
        }
      },
      printerPresets: 'standard'
    };

    testTemplate = await templateModel.create(templateData);
  });

  afterEach(async () => {
    await schema.close();
    
    // Clean up test files
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
    
    // Clean up any generated test files
    const dataDir = path.join(__dirname, '../data');
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir);
      files.forEach(file => {
        if (file.startsWith('test_') && file.endsWith('.png')) {
          fs.unlinkSync(path.join(dataDir, file));
        }
      });
    }
  });

  describe('loadTemplate', () => {
    test('should load template successfully', async () => {
      const template = await templateProcessor.loadTemplate(testTemplate.id, templateModel);
      
      expect(template).toBeDefined();
      expect(template.id).toBe(testTemplate.id);
      expect(template.name).toBe('Test Badge');
      expect(template.textFields).toHaveProperty('uid');
      expect(template.textFields).toHaveProperty('badgeName');
    });

    test('should throw error for non-existent template', async () => {
      await expect(
        templateProcessor.loadTemplate('non-existent-id', templateModel)
      ).rejects.toThrow('Template with ID non-existent-id not found');
    });

    test('should throw error for template with missing file', async () => {
      // Remove the template file
      fs.unlinkSync(testFilePath);
      
      await expect(
        templateProcessor.loadTemplate(testTemplate.id, templateModel)
      ).rejects.toThrow('Failed to load template');
    });
  });

  describe('generateBadge', () => {
    test('should generate badge successfully', async () => {
      const badgeBuffer = await templateProcessor.generateBadge(
        testTemplate.id,
        'TEST123',
        'John Doe',
        templateModel
      );
      
      expect(badgeBuffer).toBeInstanceOf(Buffer);
      expect(badgeBuffer.length).toBeGreaterThan(0);
      
      // Verify it's a valid PNG
      expect(badgeBuffer.slice(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
      );
    });

    test('should throw error for empty UID', async () => {
      await expect(
        templateProcessor.generateBadge(testTemplate.id, '', 'John Doe', templateModel)
      ).rejects.toThrow('UID is required and must be a non-empty string');
    });

    test('should throw error for empty badge name', async () => {
      await expect(
        templateProcessor.generateBadge(testTemplate.id, 'TEST123', '', templateModel)
      ).rejects.toThrow('Badge name is required and must be a non-empty string');
    });

    test('should throw error for non-string UID', async () => {
      await expect(
        templateProcessor.generateBadge(testTemplate.id, 123, 'John Doe', templateModel)
      ).rejects.toThrow('UID is required and must be a non-empty string');
    });

    test('should throw error for non-string badge name', async () => {
      await expect(
        templateProcessor.generateBadge(testTemplate.id, 'TEST123', null, templateModel)
      ).rejects.toThrow('Badge name is required and must be a non-empty string');
    });

    test('should handle whitespace in UID and badge name', async () => {
      const badgeBuffer = await templateProcessor.generateBadge(
        testTemplate.id,
        '  TEST123  ',
        '  John Doe  ',
        templateModel
      );
      
      expect(badgeBuffer).toBeInstanceOf(Buffer);
      expect(badgeBuffer.length).toBeGreaterThan(0);
    });

    test('should throw error for non-existent template', async () => {
      await expect(
        templateProcessor.generateBadge('non-existent-id', 'TEST123', 'John Doe', templateModel)
      ).rejects.toThrow('Failed to generate badge');
    });
  });

  describe('getTemplatePreview', () => {
    test('should generate template preview successfully', async () => {
      const previewBuffer = await templateProcessor.getTemplatePreview(
        testTemplate.id,
        templateModel
      );
      
      expect(previewBuffer).toBeInstanceOf(Buffer);
      expect(previewBuffer.length).toBeGreaterThan(0);
      
      // Verify it's a valid PNG
      expect(previewBuffer.slice(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
      );
    });

    test('should throw error for non-existent template', async () => {
      await expect(
        templateProcessor.getTemplatePreview('non-existent-id', templateModel)
      ).rejects.toThrow('Failed to generate template preview');
    });
  });

  describe('validateTemplate', () => {
    test('should validate existing template file', async () => {
      const result = await templateProcessor.validateTemplate(testFilePath);
      
      expect(result.isValid).toBe(true);
      expect(result.fileSize).toBeGreaterThan(0);
      expect(result.extension).toBe('.indd');
      expect(result.lastModified).toBeTruthy();
      expect(typeof result.lastModified.getTime).toBe('function'); // Check it's a Date-like object
    });

    test('should reject non-existent file', async () => {
      const result = await templateProcessor.validateTemplate('/non/existent/file.indd');
      
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('does not exist');
    });

    test('should reject unsupported file format', async () => {
      const txtFilePath = path.join(__dirname, '../data/test_template.txt');
      fs.writeFileSync(txtFilePath, 'test content');
      
      const result = await templateProcessor.validateTemplate(txtFilePath);
      
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Unsupported template file format');
      
      // Clean up
      fs.unlinkSync(txtFilePath);
    });

    test('should accept supported file formats', async () => {
      const supportedFormats = ['.png', '.jpg', '.jpeg', '.pdf'];
      
      for (const format of supportedFormats) {
        const testFile = path.join(__dirname, `../data/test_template${format}`);
        fs.writeFileSync(testFile, 'test content');
        
        const result = await templateProcessor.validateTemplate(testFile);
        
        expect(result.isValid).toBe(true);
        expect(result.extension).toBe(format);
        
        // Clean up
        fs.unlinkSync(testFile);
      }
    });

    test('should reject files that are too large', async () => {
      // Create a large file (simulate by checking file size)
      const largeFilePath = path.join(__dirname, '../data/large_template.indd');
      
      // Create the file first
      fs.writeFileSync(largeFilePath, 'test content');
      
      // Mock fs.statSync to return large file size
      const originalStatSync = fs.statSync;
      fs.statSync = jest.fn().mockImplementation((filePath) => {
        if (filePath === largeFilePath) {
          return {
            size: 60 * 1024 * 1024, // 60MB
            mtime: new Date()
          };
        }
        return originalStatSync(filePath);
      });
      
      const result = await templateProcessor.validateTemplate(largeFilePath);
      
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('too large');
      
      // Restore original function
      fs.statSync = originalStatSync;
      
      // Clean up
      if (fs.existsSync(largeFilePath)) {
        fs.unlinkSync(largeFilePath);
      }
    });
  });

  describe('saveBadgeToFile', () => {
    test('should save badge to file successfully', async () => {
      const badgeBuffer = await templateProcessor.generateBadge(
        testTemplate.id,
        'TEST123',
        'John Doe',
        templateModel
      );
      
      const outputPath = path.join(__dirname, '../data/test_badge_output.png');
      const savedPath = await templateProcessor.saveBadgeToFile(badgeBuffer, outputPath);
      
      expect(savedPath).toBe(outputPath);
      expect(fs.existsSync(outputPath)).toBe(true);
      
      // Verify file content
      const savedBuffer = fs.readFileSync(outputPath);
      expect(savedBuffer).toEqual(badgeBuffer);
      
      // Clean up
      fs.unlinkSync(outputPath);
    });

    test('should create output directory if it does not exist', async () => {
      const badgeBuffer = await templateProcessor.generateBadge(
        testTemplate.id,
        'TEST123',
        'John Doe',
        templateModel
      );
      
      const outputPath = path.join(__dirname, '../data/nested/dir/test_badge.png');
      const savedPath = await templateProcessor.saveBadgeToFile(badgeBuffer, outputPath);
      
      expect(savedPath).toBe(outputPath);
      expect(fs.existsSync(outputPath)).toBe(true);
      
      // Clean up
      fs.unlinkSync(outputPath);
      fs.rmSync(path.join(__dirname, '../data/nested'), { recursive: true });
    });
  });

  describe('resizeBadge', () => {
    test('should resize badge successfully', async () => {
      const badgeBuffer = await templateProcessor.generateBadge(
        testTemplate.id,
        'TEST123',
        'John Doe',
        templateModel
      );
      
      const resizedBuffer = await templateProcessor.resizeBadge(badgeBuffer, 200, 150);
      
      expect(resizedBuffer).toBeInstanceOf(Buffer);
      expect(resizedBuffer.length).toBeGreaterThan(0);
      
      // Verify it's a valid PNG
      expect(resizedBuffer.slice(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
      );
    });

    test('should throw error for invalid buffer', async () => {
      await expect(
        templateProcessor.resizeBadge(Buffer.from('invalid image data'), 200, 150)
      ).rejects.toThrow('Failed to resize badge');
    });
  });

  describe('renderText', () => {
    test('should render text without throwing errors', () => {
      const { createCanvas } = require('canvas');
      const canvas = createCanvas(400, 300);
      const ctx = canvas.getContext('2d');
      
      const config = {
        x: 50,
        y: 100,
        fontSize: 16,
        fontFamily: 'Arial'
      };
      
      expect(() => {
        templateProcessor.renderText(ctx, 'Test Text', config);
      }).not.toThrow();
    });

    test('should handle coordinates outside canvas bounds', () => {
      const { createCanvas } = require('canvas');
      const canvas = createCanvas(400, 300);
      const ctx = canvas.getContext('2d');
      
      const config = {
        x: 500, // Outside canvas width
        y: 400, // Outside canvas height
        fontSize: 16,
        fontFamily: 'Arial'
      };
      
      expect(() => {
        templateProcessor.renderText(ctx, 'Test Text', config);
      }).not.toThrow();
    });
  });

  describe('wrapText', () => {
    test('should wrap long text correctly', () => {
      const { createCanvas } = require('canvas');
      const canvas = createCanvas(200, 300);
      const ctx = canvas.getContext('2d');
      ctx.font = '16px Arial';
      
      const longText = 'This is a very long text that should be wrapped across multiple lines';
      
      expect(() => {
        templateProcessor.wrapText(ctx, longText, 10, 10, 180, 20);
      }).not.toThrow();
    });

    test('should handle single word text', () => {
      const { createCanvas } = require('canvas');
      const canvas = createCanvas(200, 300);
      const ctx = canvas.getContext('2d');
      ctx.font = '16px Arial';
      
      expect(() => {
        templateProcessor.wrapText(ctx, 'SingleWord', 10, 10, 180, 20);
      }).not.toThrow();
    });

    test('should handle empty text', () => {
      const { createCanvas } = require('canvas');
      const canvas = createCanvas(200, 300);
      const ctx = canvas.getContext('2d');
      ctx.font = '16px Arial';
      
      expect(() => {
        templateProcessor.wrapText(ctx, '', 10, 10, 180, 20);
      }).not.toThrow();
    });
  });
});