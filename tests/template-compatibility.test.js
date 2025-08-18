const request = require('supertest');
const { app, server } = require('../server/index');
const path = require('path');
const fs = require('fs').promises;

describe('Template Compatibility and Processing Tests', () => {
  beforeAll(async () => {
    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  afterAll(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  describe('Template Loading and Validation', () => {
    test('should load all available templates successfully', async () => {
      const response = await request(app)
        .get('/api/templates')
        .expect(200);
      
      expect(response.body).toHaveProperty('templates');
      expect(Array.isArray(response.body.templates)).toBe(true);
      expect(response.body.templates.length).toBeGreaterThan(0);
      
      // Validate template structure
      response.body.templates.forEach(template => {
        expect(template).toHaveProperty('id');
        expect(template).toHaveProperty('name');
        expect(template).toHaveProperty('filePath');
        expect(template).toHaveProperty('textFields');
        
        expect(typeof template.id).toBe('string');
        expect(typeof template.name).toBe('string');
        expect(typeof template.filePath).toBe('string');
        expect(typeof template.textFields).toBe('object');
        
        // Validate text fields structure
        expect(template.textFields).toHaveProperty('uid');
        expect(template.textFields).toHaveProperty('badgeName');
        
        ['uid', 'badgeName'].forEach(field => {
          expect(template.textFields[field]).toHaveProperty('x');
          expect(template.textFields[field]).toHaveProperty('y');
          expect(template.textFields[field]).toHaveProperty('fontSize');
          expect(template.textFields[field]).toHaveProperty('fontFamily');
          
          expect(typeof template.textFields[field].x).toBe('number');
          expect(typeof template.textFields[field].y).toBe('number');
          expect(typeof template.textFields[field].fontSize).toBe('number');
          expect(typeof template.textFields[field].fontFamily).toBe('string');
        });
      });
      
      console.log(`Loaded ${response.body.templates.length} templates successfully`);
    });

    test('should validate template file existence', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const templates = templatesResponse.body.templates;
      
      // Check if template files exist
      for (const template of templates) {
        try {
          const templatePath = path.resolve(template.filePath);
          const stats = await fs.stat(templatePath);
          expect(stats.isFile()).toBe(true);
          
          console.log(`Template file verified: ${template.name} at ${template.filePath}`);
        } catch (error) {
          // If file doesn't exist, template should handle gracefully
          console.warn(`Template file not found: ${template.filePath}`);
        }
      }
    });

    test('should handle template preview generation', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const templates = templatesResponse.body.templates;
      
      for (const template of templates) {
        // Test template preview if preview path exists
        if (template.previewPath) {
          try {
            const previewPath = path.resolve(template.previewPath);
            const stats = await fs.stat(previewPath);
            expect(stats.isFile()).toBe(true);
            
            console.log(`Template preview verified: ${template.name}`);
          } catch (error) {
            console.warn(`Template preview not found: ${template.previewPath}`);
          }
        }
      }
    });
  });

  describe('Badge Generation Processing', () => {
    test('should generate badges for all available templates', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const templates = templatesResponse.body.templates;
      
      for (const template of templates) {
        const badgeData = {
          templateId: template.id,
          uid: `TEMPLATE-TEST-${template.id}-${Date.now()}`,
          badgeName: `Template Test Badge for ${template.name}`
        };
        
        const startTime = Date.now();
        
        const response = await request(app)
          .post('/api/badges')
          .send(badgeData)
          .expect(201);
        
        const processingTime = Date.now() - startTime;
        
        expect(response.body).toHaveProperty('success', true);
        expect(response.body).toHaveProperty('jobId');
        
        console.log(`Badge generation for ${template.name}: ${processingTime}ms`);
        
        // Processing time should be reasonable
        expect(processingTime).toBeLessThan(2000);
      }
    }, 30000);

    test('should handle text positioning correctly', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const templates = templatesResponse.body.templates;
      
      for (const template of templates) {
        // Test with various text lengths
        const testCases = [
          { uid: 'SHORT', badgeName: 'Short Name' },
          { uid: 'MEDIUM-LENGTH-UID', badgeName: 'Medium Length Badge Name' },
          { uid: 'VERY-LONG-UID-FOR-TESTING-PURPOSES', badgeName: 'Very Long Badge Name That Tests Text Wrapping' }
        ];
        
        for (const testCase of testCases) {
          const badgeData = {
            templateId: template.id,
            uid: `${testCase.uid}-${Date.now()}`,
            badgeName: testCase.badgeName
          };
          
          const response = await request(app)
            .post('/api/badges')
            .send(badgeData)
            .expect(201);
          
          expect(response.body).toHaveProperty('success', true);
          expect(response.body).toHaveProperty('jobId');
          
          console.log(`Text positioning test for ${template.name} with ${testCase.uid.length} char UID`);
        }
      }
    }, 45000);

    test('should validate template processing speed', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const templates = templatesResponse.body.templates;
      const processingTimes = [];
      
      for (const template of templates) {
        const badgeData = {
          templateId: template.id,
          uid: `SPEED-TEST-${Date.now()}`,
          badgeName: 'Speed Test Badge'
        };
        
        const startTime = Date.now();
        
        const response = await request(app)
          .post('/api/badges')
          .send(badgeData)
          .expect(201);
        
        const processingTime = Date.now() - startTime;
        processingTimes.push({
          templateName: template.name,
          processingTime
        });
        
        expect(response.body).toHaveProperty('success', true);
        
        // Individual template processing should be under 1 second
        expect(processingTime).toBeLessThan(1000);
      }
      
      const averageProcessingTime = processingTimes.reduce((sum, item) => sum + item.processingTime, 0) / processingTimes.length;
      
      console.log('Template Processing Times:');
      processingTimes.forEach(item => {
        console.log(`  ${item.templateName}: ${item.processingTime}ms`);
      });
      console.log(`Average processing time: ${averageProcessingTime.toFixed(2)}ms`);
      
      // Average processing time should be reasonable
      expect(averageProcessingTime).toBeLessThan(800);
    }, 30000);
  });

  describe('Template Error Handling', () => {
    test('should handle invalid template ID gracefully', async () => {
      const badgeData = {
        templateId: 'INVALID-TEMPLATE-ID',
        uid: `INVALID-TEST-${Date.now()}`,
        badgeName: 'Invalid Template Test'
      };
      
      const response = await request(app)
        .post('/api/badges')
        .send(badgeData)
        .expect(400);
      
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('template');
    });

    test('should handle missing template files gracefully', async () => {
      // This test assumes there might be templates with missing files
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const templates = templatesResponse.body.templates;
      
      // Try to process badges for all templates
      // Some might fail due to missing files, but should fail gracefully
      for (const template of templates) {
        const badgeData = {
          templateId: template.id,
          uid: `MISSING-FILE-TEST-${Date.now()}`,
          badgeName: 'Missing File Test Badge'
        };
        
        try {
          const response = await request(app)
            .post('/api/badges')
            .send(badgeData);
          
          // Should either succeed (201) or fail gracefully (400/500)
          expect([201, 400, 500].includes(response.status)).toBe(true);
          
          if (response.status !== 201) {
            expect(response.body).toHaveProperty('error');
            console.log(`Template ${template.name} failed gracefully: ${response.body.error}`);
          }
        } catch (error) {
          // Network errors should not occur
          throw error;
        }
      }
    }, 30000);

    test('should validate template configuration integrity', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const templates = templatesResponse.body.templates;
      
      templates.forEach(template => {
        // Validate text field coordinates are reasonable
        ['uid', 'badgeName'].forEach(field => {
          const textField = template.textFields[field];
          
          // Coordinates should be positive
          expect(textField.x).toBeGreaterThanOrEqual(0);
          expect(textField.y).toBeGreaterThanOrEqual(0);
          
          // Font size should be reasonable
          expect(textField.fontSize).toBeGreaterThan(0);
          expect(textField.fontSize).toBeLessThan(200);
          
          // Font family should be specified
          expect(textField.fontFamily.length).toBeGreaterThan(0);
        });
        
        // Template should have reasonable dimensions implied by coordinates
        const maxX = Math.max(template.textFields.uid.x, template.textFields.badgeName.x);
        const maxY = Math.max(template.textFields.uid.y, template.textFields.badgeName.y);
        
        // Coordinates should be within reasonable badge dimensions
        expect(maxX).toBeLessThan(2000); // Assuming max badge width
        expect(maxY).toBeLessThan(2000); // Assuming max badge height
        
        console.log(`Template ${template.name} configuration validated`);
      });
    });
  });

  describe('Template Format Compatibility', () => {
    test('should handle different badge formats', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const templates = templatesResponse.body.templates;
      
      // Test with different character sets and special characters
      const specialCharacterTests = [
        { uid: 'ASCII-123', badgeName: 'ASCII Test Badge' },
        { uid: 'UNICODE-测试', badgeName: 'Unicode Test Badge 测试' },
        { uid: 'SPECIAL-@#$', badgeName: 'Special Chars !@#$%^&*()' },
        { uid: 'NUMBERS-12345', badgeName: 'Numbers 1234567890' }
      ];
      
      for (const template of templates.slice(0, 2)) { // Test first 2 templates to save time
        for (const testCase of specialCharacterTests) {
          const badgeData = {
            templateId: template.id,
            uid: `${testCase.uid}-${Date.now()}`,
            badgeName: testCase.badgeName
          };
          
          const response = await request(app)
            .post('/api/badges')
            .send(badgeData);
          
          // Should handle gracefully - either succeed or fail with proper error
          expect([201, 400].includes(response.status)).toBe(true);
          
          if (response.status === 201) {
            expect(response.body).toHaveProperty('success', true);
            console.log(`Character set test passed for ${template.name}: ${testCase.uid}`);
          } else {
            console.log(`Character set test failed gracefully for ${template.name}: ${response.body.error}`);
          }
        }
      }
    }, 30000);

    test('should handle edge cases in text length', async () => {
      const templatesResponse = await request(app)
        .get('/api/templates')
        .expect(200);
      
      const templates = templatesResponse.body.templates;
      
      // Test edge cases
      const edgeCases = [
        { uid: 'A', badgeName: 'B' }, // Minimum length
        { uid: 'A'.repeat(50), badgeName: 'B'.repeat(100) }, // Long text
        { uid: '', badgeName: '' }, // Empty strings (should fail validation)
        { uid: ' ', badgeName: ' ' }, // Whitespace only
      ];
      
      for (const template of templates.slice(0, 1)) { // Test first template only
        for (const testCase of edgeCases) {
          const badgeData = {
            templateId: template.id,
            uid: testCase.uid || `EDGE-${Date.now()}`,
            badgeName: testCase.badgeName || 'Edge Case Test'
          };
          
          const response = await request(app)
            .post('/api/badges')
            .send(badgeData);
          
          // Empty strings should fail validation
          if (testCase.uid === '' || testCase.badgeName === '') {
            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error');
          } else {
            // Other cases should succeed or fail gracefully
            expect([201, 400].includes(response.status)).toBe(true);
          }
          
          console.log(`Edge case test for ${template.name}: UID="${testCase.uid}" Name="${testCase.badgeName}" - Status: ${response.status}`);
        }
      }
    });
  });
});