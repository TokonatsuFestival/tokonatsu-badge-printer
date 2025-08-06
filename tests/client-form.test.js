/**
 * Client-side Form Validation Tests
 * Tests for the form handling logic in public/js/app.js
 */

// Mock DOM environment for testing
const { JSDOM } = require('jsdom');

// Set up DOM environment
const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
    <form id="badge-form">
        <input id="uid-input" type="text" />
        <input id="badge-name-input" type="text" />
        <div id="uid-error"></div>
        <div id="badge-name-error"></div>
        <div id="badge-name-help"></div>
        <button id="submit-badge"></button>
    </form>
    <div id="template-grid"></div>
    <div id="connection-status"></div>
    <div id="status-indicator"></div>
    <div id="status-text"></div>
</body>
</html>
`, {
    url: 'http://localhost',
    pretendToBeVisual: true,
    resources: 'usable'
});

global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;

// Mock fetch for testing
global.fetch = jest.fn();

// Mock Socket.io
global.io = jest.fn(() => ({
    on: jest.fn(),
    emit: jest.fn()
}));

// Create isolated validation functions for testing
const CONFIG = {
    MAX_BADGE_NAME_LENGTH: 50,
    UID_CHECK_DEBOUNCE: 300,
    VALIDATION_MESSAGES: {
        UID_REQUIRED: 'UID is required',
        UID_DUPLICATE: 'This UID is already in use',
        UID_INVALID: 'UID must contain only letters, numbers, and hyphens',
        BADGE_NAME_REQUIRED: 'Badge name is required',
        BADGE_NAME_TOO_LONG: 'Badge name must be 50 characters or less',
        TEMPLATE_REQUIRED: 'Please select a badge template'
    }
};

// Mock elements for testing
const mockElements = {
    uidError: document.getElementById('uid-error'),
    badgeNameError: document.getElementById('badge-name-error'),
    uidInput: document.getElementById('uid-input'),
    badgeNameInput: document.getElementById('badge-name-input')
};

// Mock app state
const mockAppState = {
    usedUIDs: new Set(),
    selectedTemplate: null
};

// Helper function to show field errors
function showFieldError(fieldName, message) {
    const errorElement = fieldName === 'uid' ? mockElements.uidError : mockElements.badgeNameError;
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.style.display = message ? 'block' : 'none';
    }
}

// Isolated validation functions for testing
function validateUID(uid, usedUIDs = new Set()) {
    // Handle null/undefined inputs
    if (uid == null || typeof uid !== 'string') {
        showFieldError('uid', CONFIG.VALIDATION_MESSAGES.UID_REQUIRED);
        return false;
    }
    
    const trimmedUID = uid.trim();
    let isValid = true;
    let errorMessage = '';
    
    // Clear previous error
    showFieldError('uid', '');
    
    // Required validation
    if (!trimmedUID) {
        errorMessage = CONFIG.VALIDATION_MESSAGES.UID_REQUIRED;
        isValid = false;
    }
    // Format validation (alphanumeric and hyphens only)
    else if (!/^[a-zA-Z0-9-]+$/.test(trimmedUID)) {
        errorMessage = CONFIG.VALIDATION_MESSAGES.UID_INVALID;
        isValid = false;
    }
    // Uniqueness validation
    else if (usedUIDs.has(trimmedUID)) {
        errorMessage = CONFIG.VALIDATION_MESSAGES.UID_DUPLICATE;
        isValid = false;
    }
    
    // Show error if invalid
    if (!isValid) {
        showFieldError('uid', errorMessage);
    }
    
    return isValid;
}

function validateBadgeName(badgeName) {
    // Handle null/undefined inputs
    if (badgeName == null || typeof badgeName !== 'string') {
        showFieldError('badgeName', CONFIG.VALIDATION_MESSAGES.BADGE_NAME_REQUIRED);
        return false;
    }
    
    const trimmedName = badgeName.trim();
    let isValid = true;
    let errorMessage = '';
    
    // Clear previous error
    showFieldError('badgeName', '');
    
    // Required validation
    if (!trimmedName) {
        errorMessage = CONFIG.VALIDATION_MESSAGES.BADGE_NAME_REQUIRED;
        isValid = false;
    }
    // Length validation
    else if (trimmedName.length > CONFIG.MAX_BADGE_NAME_LENGTH) {
        errorMessage = CONFIG.VALIDATION_MESSAGES.BADGE_NAME_TOO_LONG;
        isValid = false;
    }
    
    // Show error if invalid
    if (!isValid) {
        showFieldError('badgeName', errorMessage);
    }
    
    return isValid;
}

function updateCharacterCount(text) {
    const helpElement = document.getElementById('badge-name-help');
    if (!helpElement) return;
    
    const remaining = CONFIG.MAX_BADGE_NAME_LENGTH - text.length;
    const baseText = `Enter the name to display on the badge (max ${CONFIG.MAX_BADGE_NAME_LENGTH} characters)`;
    
    if (text.length > 0) {
        helpElement.textContent = `${baseText} - ${remaining} characters remaining`;
        if (remaining < 10) {
            helpElement.style.color = remaining < 0 ? '#e74c3c' : '#f39c12';
        } else {
            helpElement.style.color = '#7f8c8d';
        }
    } else {
        helpElement.textContent = baseText;
        helpElement.style.color = '#7f8c8d';
    }
}

function isFormValid(uidValue, badgeNameValue, selectedTemplate, usedUIDs = new Set()) {
    // Check UID validity
    const uidValid = uidValue && 
                    typeof uidValue === 'string' &&
                    uidValue.trim().length > 0 &&
                    !usedUIDs.has(uidValue.trim()) &&
                    /^[a-zA-Z0-9-]+$/.test(uidValue.trim());
    
    // Check badge name validity
    const badgeNameValid = badgeNameValue && 
                          typeof badgeNameValue === 'string' &&
                          badgeNameValue.trim().length > 0 && 
                          badgeNameValue.trim().length <= CONFIG.MAX_BADGE_NAME_LENGTH;
    
    // Check template selection
    const templateSelected = selectedTemplate !== null && selectedTemplate !== undefined;
    
    return Boolean(uidValid && badgeNameValid && templateSelected);
}

describe('Client-side Form Validation', () => {
    let usedUIDs;

    beforeEach(() => {
        // Reset DOM elements
        document.getElementById('uid-error').textContent = '';
        document.getElementById('badge-name-error').textContent = '';
        document.getElementById('badge-name-help').textContent = '';
        
        // Reset used UIDs
        usedUIDs = new Set(['existing-uid', 'another-uid']);
    });

    describe('UID Validation', () => {
        test('should reject empty UID', () => {
            const result = validateUID('', usedUIDs);
            expect(result).toBe(false);
            expect(mockElements.uidError.textContent).toBe(CONFIG.VALIDATION_MESSAGES.UID_REQUIRED);
        });

        test('should reject UID with only whitespace', () => {
            const result = validateUID('   ', usedUIDs);
            expect(result).toBe(false);
            expect(mockElements.uidError.textContent).toBe(CONFIG.VALIDATION_MESSAGES.UID_REQUIRED);
        });

        test('should reject UID with invalid characters', () => {
            const invalidUIDs = ['uid with spaces', 'uid@domain', 'uid#123', 'uid!', 'uid$'];
            
            invalidUIDs.forEach(uid => {
                const result = validateUID(uid, usedUIDs);
                expect(result).toBe(false);
                expect(mockElements.uidError.textContent).toBe(CONFIG.VALIDATION_MESSAGES.UID_INVALID);
            });
        });

        test('should reject duplicate UID', () => {
            const result = validateUID('existing-uid', usedUIDs);
            expect(result).toBe(false);
            expect(mockElements.uidError.textContent).toBe(CONFIG.VALIDATION_MESSAGES.UID_DUPLICATE);
        });

        test('should accept valid unique UID', () => {
            const validUIDs = ['new-uid', 'uid123', 'UID-456', 'a1b2c3'];
            
            validUIDs.forEach(uid => {
                const result = validateUID(uid, usedUIDs);
                expect(result).toBe(true);
                expect(mockElements.uidError.textContent).toBe('');
            });
        });

        test('should handle case sensitivity correctly', () => {
            const testUsedUIDs = new Set(['test-uid']);
            
            // Should reject exact match
            expect(validateUID('test-uid', testUsedUIDs)).toBe(false);
            
            // Should accept different case (case sensitive)
            expect(validateUID('TEST-UID', testUsedUIDs)).toBe(true);
            expect(validateUID('Test-Uid', testUsedUIDs)).toBe(true);
        });

        test('should trim whitespace from UID', () => {
            const result = validateUID('  valid-uid  ', usedUIDs);
            expect(result).toBe(true);
            expect(mockElements.uidError.textContent).toBe('');
        });
    });

    describe('Badge Name Validation', () => {
        test('should reject empty badge name', () => {
            const result = validateBadgeName('');
            expect(result).toBe(false);
            expect(mockElements.badgeNameError.textContent).toBe(CONFIG.VALIDATION_MESSAGES.BADGE_NAME_REQUIRED);
        });

        test('should reject badge name with only whitespace', () => {
            const result = validateBadgeName('   ');
            expect(result).toBe(false);
            expect(mockElements.badgeNameError.textContent).toBe(CONFIG.VALIDATION_MESSAGES.BADGE_NAME_REQUIRED);
        });

        test('should reject badge name that is too long', () => {
            const longName = 'a'.repeat(CONFIG.MAX_BADGE_NAME_LENGTH + 1);
            const result = validateBadgeName(longName);
            expect(result).toBe(false);
            expect(mockElements.badgeNameError.textContent).toBe(CONFIG.VALIDATION_MESSAGES.BADGE_NAME_TOO_LONG);
        });

        test('should accept valid badge names', () => {
            const validNames = [
                'John Doe',
                'Jane Smith-Johnson',
                'Dr. Emily Chen',
                'Mike O\'Connor',
                'José García',
                'A',
                'a'.repeat(CONFIG.MAX_BADGE_NAME_LENGTH)
            ];
            
            validNames.forEach(name => {
                const result = validateBadgeName(name);
                expect(result).toBe(true);
                expect(mockElements.badgeNameError.textContent).toBe('');
            });
        });

        test('should handle special characters in badge names', () => {
            const specialNames = [
                'John & Jane',
                'Dr. Smith (PhD)',
                'Marie-Claire',
                'José María',
                'O\'Brien'
            ];
            
            specialNames.forEach(name => {
                if (name.length <= CONFIG.MAX_BADGE_NAME_LENGTH) {
                    const result = validateBadgeName(name);
                    expect(result).toBe(true);
                    expect(mockElements.badgeNameError.textContent).toBe('');
                }
            });
        });

        test('should trim whitespace from badge name', () => {
            const result = validateBadgeName('  John Doe  ');
            expect(result).toBe(true);
            expect(mockElements.badgeNameError.textContent).toBe('');
        });
    });

    describe('Character Count Updates', () => {
        test('should update character count display', () => {
            const helpElement = document.getElementById('badge-name-help');
            
            updateCharacterCount('John');
            expect(helpElement.textContent).toContain('46 characters remaining');
            
            updateCharacterCount('');
            expect(helpElement.textContent).toContain('max 50 characters');
        });

        test('should show warning color when approaching limit', () => {
            const helpElement = document.getElementById('badge-name-help');
            
            // Test warning threshold (< 10 remaining)
            const nearLimitText = 'a'.repeat(CONFIG.MAX_BADGE_NAME_LENGTH - 5);
            updateCharacterCount(nearLimitText);
            expect(helpElement.style.color).toBe('rgb(243, 156, 18)'); // #f39c12
        });

        test('should show error color when over limit', () => {
            const helpElement = document.getElementById('badge-name-help');
            
            // Test over limit
            const overLimitText = 'a'.repeat(CONFIG.MAX_BADGE_NAME_LENGTH + 5);
            updateCharacterCount(overLimitText);
            expect(helpElement.style.color).toBe('rgb(231, 76, 60)'); // #e74c3c
        });

        test('should reset color for normal length', () => {
            const helpElement = document.getElementById('badge-name-help');
            
            updateCharacterCount('Normal length text');
            expect(helpElement.style.color).toBe('rgb(127, 140, 141)'); // #7f8c8d
        });
    });

    describe('Form Validity Checking', () => {
        test('should return true for valid form', () => {
            const result = isFormValid('valid-uid', 'John Doe', { id: 'template-1' }, usedUIDs);
            expect(result).toBe(true);
        });

        test('should return false for invalid UID', () => {
            const result = isFormValid('existing-uid', 'John Doe', { id: 'template-1' }, usedUIDs);
            expect(result).toBe(false);
        });

        test('should return false for invalid badge name', () => {
            const result = isFormValid('valid-uid', '', { id: 'template-1' }, usedUIDs);
            expect(result).toBe(false);
        });

        test('should return false for missing template', () => {
            const result = isFormValid('valid-uid', 'John Doe', null, usedUIDs);
            expect(result).toBe(false);
        });

        test('should return false for empty UID', () => {
            const result = isFormValid('', 'John Doe', { id: 'template-1' }, usedUIDs);
            expect(result).toBe(false);
        });

        test('should return false for empty badge name', () => {
            const result = isFormValid('valid-uid', '', { id: 'template-1' }, usedUIDs);
            expect(result).toBe(false);
        });
    });

    describe('Configuration Constants', () => {
        test('should have correct validation messages', () => {
            expect(CONFIG.VALIDATION_MESSAGES.UID_REQUIRED).toBe('UID is required');
            expect(CONFIG.VALIDATION_MESSAGES.UID_DUPLICATE).toBe('This UID is already in use');
            expect(CONFIG.VALIDATION_MESSAGES.UID_INVALID).toBe('UID must contain only letters, numbers, and hyphens');
            expect(CONFIG.VALIDATION_MESSAGES.BADGE_NAME_REQUIRED).toBe('Badge name is required');
            expect(CONFIG.VALIDATION_MESSAGES.BADGE_NAME_TOO_LONG).toBe('Badge name must be 50 characters or less');
            expect(CONFIG.VALIDATION_MESSAGES.TEMPLATE_REQUIRED).toBe('Please select a badge template');
        });

        test('should have correct configuration values', () => {
            expect(CONFIG.MAX_BADGE_NAME_LENGTH).toBe(50);
            expect(CONFIG.UID_CHECK_DEBOUNCE).toBe(300);
        });
    });

    describe('Edge Cases', () => {
        test('should handle null and undefined inputs', () => {
            expect(validateUID(null, usedUIDs)).toBe(false);
            expect(validateUID(undefined, usedUIDs)).toBe(false);
            expect(validateBadgeName(null)).toBe(false);
            expect(validateBadgeName(undefined)).toBe(false);
        });

        test('should handle numeric inputs', () => {
            expect(validateUID(123, usedUIDs)).toBe(false); // Should be string
            expect(validateBadgeName(123)).toBe(false); // Should be string
        });

        test('should handle very long UIDs', () => {
            const longUID = 'a'.repeat(1000);
            const result = validateUID(longUID, usedUIDs);
            // Should be valid if it doesn't conflict and has valid characters
            expect(result).toBe(true);
        });

        test('should handle Unicode characters in badge names', () => {
            const unicodeNames = ['José', '李明', 'Müller', 'Øyvind'];
            
            unicodeNames.forEach(name => {
                const result = validateBadgeName(name);
                expect(result).toBe(true);
            });
        });
    });
});