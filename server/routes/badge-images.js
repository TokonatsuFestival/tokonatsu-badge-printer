const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// GET /api/badge-images - Get available badge images
router.get('/', async (req, res, next) => {
  try {
    const imagesDir = path.join(__dirname, '../../public/images/badges');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }
    
    const files = fs.readdirSync(imagesDir);
    const imageFiles = files.filter(file => 
      /\.(jpg|jpeg|png|gif)$/i.test(file)
    );
    
    const images = imageFiles.map(filename => ({
      filename,
      name: path.basename(filename, path.extname(filename)),
      path: `/images/badges/${filename}`
    }));
    
    res.json({
      message: 'Badge images retrieved successfully',
      images,
      count: images.length
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;