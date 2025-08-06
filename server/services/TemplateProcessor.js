const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

class TemplateProcessor {
  constructor() {
    this.defaultCanvasWidth = 400;
    this.defaultCanvasHeight = 300;
    this.defaultBackgroundColor = '#ffffff';
  }

  /**
   * Load template metadata and configuration
   * @param {string} templateId - Template identifier
   * @param {Object} templateModel - Template model instance
   * @returns {Object} Template configuration
   */
  async loadTemplate(templateId, templateModel) {
    try {
      const template = await templateModel.findById(templateId);
      if (!template) {
        throw new Error(`Template with ID ${templateId} not found`);
      }

      // Validate template file exists
      await templateModel.validateTemplateFile(templateId);

      return template;
    } catch (error) {
      throw new Error(`Failed to load template: ${error.message}`);
    }
  }

  /**
   * Generate badge using template configuration
   * @param {string} templateId - Template identifier
   * @param {string} uid - User identifier
   * @param {string} badgeName - Badge name
   * @param {Object} templateModel - Template model instance
   * @returns {Buffer} Generated badge as PNG buffer
   */
  async generateBadge(templateId, uid, badgeName, templateModel, badgeImage = null) {
    try {
      const template = await this.loadTemplate(templateId, templateModel);
      
      // Validate input parameters
      if (!uid || typeof uid !== 'string' || uid.trim() === '') {
        throw new Error('UID is required and must be a non-empty string');
      }
      
      if (!badgeName || typeof badgeName !== 'string' || badgeName.trim() === '') {
        throw new Error('Badge name is required and must be a non-empty string');
      }

      // Create canvas with actual badge dimensions
      const canvas = createCanvas(1226, 799); // Actual badge dimensions
      const ctx = canvas.getContext('2d');

      // Try to load background image
      let backgroundPath;
      if (badgeImage) {
        backgroundPath = path.join(__dirname, '../../public/images/badges', badgeImage);
        console.log('Looking for badge image at:', backgroundPath);
      } else {
        const templateDir = path.dirname(template.filePath || template.file_path || '');
        backgroundPath = path.join(templateDir, 'background.png');
      }
      
      try {
        if (fs.existsSync(backgroundPath)) {
          console.log('Loading background image:', backgroundPath);
          const backgroundImage = await loadImage(backgroundPath);
          ctx.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height);
        } else {
          console.log('Background image not found, using default');
          // Default background with badge-like styling
          ctx.fillStyle = '#f8f9fa';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          // Add border
          ctx.strokeStyle = '#dee2e6';
          ctx.lineWidth = 3;
          ctx.strokeRect(0, 0, canvas.width, canvas.height);
        }
      } catch (error) {
        console.log('Error loading background:', error.message);
        // Fallback to simple background
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // Parse text fields configuration
      let textFields;
      try {
        textFields = typeof template.textFields === 'string' 
          ? JSON.parse(template.textFields) 
          : template.textFields;
      } catch (e) {
        textFields = [];
      }

      // Find configurations for uid and badgeName
      const uidField = textFields.find(field => field.name === 'uid');
      const badgeNameField = textFields.find(field => field.name === 'badgeName');
      
      console.log('Using text fields from database:', textFields);
      
      // Handle both old format (x,y,fontSize) and new format (x1,y1,x2,y2)
      let uidConfig, badgeNameConfig;
      
      if (uidField && uidField.x1 !== undefined) {
        // New bounding box format
        uidConfig = {
          x1: uidField.x1,
          y1: uidField.y1,
          x2: uidField.x2,
          y2: uidField.y2,
          fontFamily: uidField.fontFamily || 'Arial'
        };
      } else if (uidField) {
        // Old format - convert to bounding box
        uidConfig = {
          x1: uidField.x,
          y1: uidField.y,
          x2: uidField.x + 200,
          y2: uidField.y + 70,
          fontFamily: uidField.fontFamily || 'Arial'
        };
      } else {
        // Default
        uidConfig = { x1: 100, y1: 650, x2: 300, y2: 720, fontFamily: 'Hiragino Kaku Gothic Pro' };
      }
      
      if (badgeNameField && badgeNameField.x1 !== undefined) {
        // New bounding box format
        badgeNameConfig = {
          x1: badgeNameField.x1,
          y1: badgeNameField.y1,
          x2: badgeNameField.x2,
          y2: badgeNameField.y2,
          fontFamily: badgeNameField.fontFamily || 'Arial Bold'
        };
      } else if (badgeNameField) {
        // Old format - convert to bounding box
        badgeNameConfig = {
          x1: badgeNameField.x,
          y1: badgeNameField.y,
          x2: badgeNameField.x + 400,
          y2: badgeNameField.y + 100,
          fontFamily: badgeNameField.fontFamily || 'Arial Bold'
        };
      } else {
        // Default
        badgeNameConfig = { x1: 100, y1: 250, x2: 500, y2: 350, fontFamily: 'Hiragino Kaku Gothic Pro' };
      }
      
      console.log('Final text configs:', { uidConfig, badgeNameConfig });

      // Render UID text
      this.renderText(ctx, uid.trim(), uidConfig);

      // Render badge name text
      this.renderText(ctx, badgeName.trim(), badgeNameConfig);

      // Convert canvas to buffer
      return canvas.toBuffer('image/png');
    } catch (error) {
      throw new Error(`Failed to generate badge: ${error.message}`);
    }
  }

  /**
   * Generate template preview
   * @param {string} templateId - Template identifier
   * @param {Object} templateModel - Template model instance
   * @returns {Buffer} Preview image as PNG buffer
   */
  async getTemplatePreview(templateId, templateModel, badgeImage = null) {
    try {
      // Generate preview with sample data
      const previewBuffer = await this.generateBadge(
        templateId, 
        'SAMPLE123', 
        'John Doe', 
        templateModel,
        badgeImage
      );

      // Add preview overlay to indicate it's a sample
      const canvas = createCanvas(1226, 799);
      const ctx = canvas.getContext('2d');

      // Load the generated badge
      const badgeImageBuffer = await loadImage(previewBuffer);
      ctx.drawImage(badgeImageBuffer, 0, 0);

      // Add semi-transparent overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Add "PREVIEW" watermark
      ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
      ctx.font = 'bold 24px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('PREVIEW', canvas.width / 2, canvas.height / 2);

      return canvas.toBuffer('image/png');
    } catch (error) {
      throw new Error(`Failed to generate template preview: ${error.message}`);
    }
  }

  /**
   * Validate template file and configuration
   * @param {string} templatePath - Path to template file
   * @returns {Object} Validation result
   */
  async validateTemplate(templatePath) {
    try {
      // Check if file exists
      if (!fs.existsSync(templatePath)) {
        return {
          isValid: false,
          error: `Template file does not exist: ${templatePath}`
        };
      }

      // Check file extension (for now, we'll accept various formats)
      const ext = path.extname(templatePath).toLowerCase();
      const supportedExtensions = ['.indd', '.png', '.jpg', '.jpeg', '.pdf'];
      
      if (!supportedExtensions.includes(ext)) {
        return {
          isValid: false,
          error: `Unsupported template file format: ${ext}. Supported formats: ${supportedExtensions.join(', ')}`
        };
      }

      // Check file size (limit to 50MB)
      const stats = fs.statSync(templatePath);
      const maxSize = 50 * 1024 * 1024; // 50MB
      
      if (stats.size > maxSize) {
        return {
          isValid: false,
          error: `Template file too large: ${Math.round(stats.size / 1024 / 1024)}MB. Maximum size: 50MB`
        };
      }

      // Check file readability
      try {
        fs.accessSync(templatePath, fs.constants.R_OK);
      } catch (error) {
        return {
          isValid: false,
          error: `Template file is not readable: ${templatePath}`
        };
      }

      return {
        isValid: true,
        fileSize: stats.size,
        extension: ext,
        lastModified: stats.mtime
      };
    } catch (error) {
      return {
        isValid: false,
        error: `Template validation failed: ${error.message}`
      };
    }
  }

  /**
   * Render text on canvas with specified configuration
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {string} text - Text to render
   * @param {Object} config - Text configuration (x1, y1, x2, y2, fontFamily) or old format (x, y, fontSize, fontFamily)
   */
  renderText(ctx, text, config) {
    try {
      let x, y, fontSize;
      
      if (config.x1 !== undefined) {
        // New bounding box format - auto-scale text
        const width = config.x2 - config.x1;
        const height = config.y2 - config.y1;
        fontSize = Math.min(height * 0.6, width / text.length * 1.2);
        
        x = config.x1 + width / 2;
        y = config.y1 + height / 2;
        
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
      } else {
        // Old format
        x = config.x;
        y = config.y;
        fontSize = config.fontSize;
        
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
      }
      
      // Set font
      ctx.font = `${fontSize}px ${config.fontFamily}`;
      ctx.fillStyle = '#000000'; // Default to black text

      // Render text
      ctx.fillText(text, x, y);
    } catch (error) {
      throw new Error(`Failed to render text: ${error.message}`);
    }
  }

  /**
   * Wrap text to fit within specified width
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {string} text - Text to wrap
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {number} maxWidth - Maximum width
   * @param {number} lineHeight - Line height
   */
  wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let currentY = y;

    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i] + ' ';
      const metrics = ctx.measureText(testLine);
      const testWidth = metrics.width;

      if (testWidth > maxWidth && i > 0) {
        ctx.fillText(line, x, currentY);
        line = words[i] + ' ';
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, currentY);
  }

  /**
   * Save generated badge to file
   * @param {Buffer} badgeBuffer - Badge image buffer
   * @param {string} outputPath - Output file path
   * @returns {string} Saved file path
   */
  async saveBadgeToFile(badgeBuffer, outputPath) {
    try {
      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Write buffer to file
      fs.writeFileSync(outputPath, badgeBuffer);
      
      return outputPath;
    } catch (error) {
      throw new Error(`Failed to save badge to file: ${error.message}`);
    }
  }

  /**
   * Resize badge image to specific dimensions
   * @param {Buffer} badgeBuffer - Badge image buffer
   * @param {number} width - Target width
   * @param {number} height - Target height
   * @returns {Buffer} Resized image buffer
   */
  async resizeBadge(badgeBuffer, width, height) {
    try {
      return await sharp(badgeBuffer)
        .resize(width, height, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        })
        .png()
        .toBuffer();
    } catch (error) {
      throw new Error(`Failed to resize badge: ${error.message}`);
    }
  }
}

module.exports = TemplateProcessor;