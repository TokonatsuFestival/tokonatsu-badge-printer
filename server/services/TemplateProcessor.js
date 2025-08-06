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
  async generateBadge(templateId, uid, badgeName, templateModel) {
    try {
      const template = await this.loadTemplate(templateId, templateModel);
      
      // Validate input parameters
      if (!uid || typeof uid !== 'string' || uid.trim() === '') {
        throw new Error('UID is required and must be a non-empty string');
      }
      
      if (!badgeName || typeof badgeName !== 'string' || badgeName.trim() === '') {
        throw new Error('Badge name is required and must be a non-empty string');
      }

      // Create canvas with default dimensions (can be customized per template)
      const canvas = createCanvas(this.defaultCanvasWidth, this.defaultCanvasHeight);
      const ctx = canvas.getContext('2d');

      // Set background
      ctx.fillStyle = this.defaultBackgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Add border for visual clarity
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

      // Render UID text
      const uidConfig = template.textFields.uid;
      this.renderText(ctx, uid.trim(), uidConfig);

      // Render badge name text
      const badgeNameConfig = template.textFields.badgeName;
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
  async getTemplatePreview(templateId, templateModel) {
    try {
      // Generate preview with sample data
      const previewBuffer = await this.generateBadge(
        templateId, 
        'SAMPLE123', 
        'John Doe', 
        templateModel
      );

      // Add preview overlay to indicate it's a sample
      const canvas = createCanvas(this.defaultCanvasWidth, this.defaultCanvasHeight);
      const ctx = canvas.getContext('2d');

      // Load the generated badge
      const badgeImage = await loadImage(previewBuffer);
      ctx.drawImage(badgeImage, 0, 0);

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
   * @param {Object} config - Text configuration (x, y, fontSize, fontFamily)
   */
  renderText(ctx, text, config) {
    try {
      // Set font
      ctx.font = `${config.fontSize}px ${config.fontFamily}`;
      ctx.fillStyle = '#000000'; // Default to black text
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      // Ensure coordinates are within canvas bounds
      const x = Math.max(0, Math.min(config.x, ctx.canvas.width - 10));
      const y = Math.max(0, Math.min(config.y, ctx.canvas.height - config.fontSize));

      // Render text with word wrapping if needed
      const maxWidth = ctx.canvas.width - x - 10; // Leave 10px margin
      this.wrapText(ctx, text, x, y, maxWidth, config.fontSize * 1.2);
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