// Festival Badge Printer Client-side JavaScript

// Initialize Socket.io connection
const socket = io();

// Application state
const appState = {
    templates: [],
    selectedTemplate: null,
    usedUIDs: new Set(),
    isSubmitting: false
};

// Configuration
const CONFIG = {
    MAX_BADGE_NAME_LENGTH: 50,
    UID_CHECK_DEBOUNCE: 300,
    VALIDATION_MESSAGES: {
        UID_REQUIRED: 'UID is required',
        UID_DUPLICATE: 'This UID is already in use',
        UID_INVALID: 'UID must contain only letters, numbers, and hyphens',
        BADGE_NAME_REQUIRED: 'Badge name is required',
        BADGE_NAME_TOO_LONG: `Badge name must be ${50} characters or less`,
        TEMPLATE_REQUIRED: 'Please select a badge template'
    }
};

// DOM Elements
let elements = {};

// Connection event handlers
socket.on('connect', () => {
    console.log('Connected to server');
    updateConnectionStatus(true);
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    updateConnectionStatus(false);
});

// DOM ready handler
document.addEventListener('DOMContentLoaded', () => {
    console.log('Festival Badge Printer initialized');
    initializeElements();
    initializeFormHandlers();
    loadTemplates();
    loadUsedUIDs();
});

// Initialize DOM element references
function initializeElements() {
    elements = {
        form: document.getElementById('badge-form'),
        templateGrid: document.getElementById('template-grid'),
        uidInput: document.getElementById('uid-input'),
        badgeNameInput: document.getElementById('badge-name-input'),
        submitButton: document.getElementById('submit-badge'),
        uidError: document.getElementById('uid-error'),
        badgeNameError: document.getElementById('badge-name-error'),
        connectionStatus: document.getElementById('connection-status'),
        statusIndicator: document.getElementById('status-indicator'),
        statusText: document.getElementById('status-text')
    };
}

// Initialize form event handlers
function initializeFormHandlers() {
    // Form submission handler
    elements.form.addEventListener('submit', handleFormSubmit);
    
    // Form reset handler
    elements.form.addEventListener('reset', handleFormReset);
    
    // UID input validation with debouncing
    let uidTimeout;
    elements.uidInput.addEventListener('input', (e) => {
        clearTimeout(uidTimeout);
        uidTimeout = setTimeout(() => {
            validateUID(e.target.value);
            updateFormValidity();
        }, CONFIG.UID_CHECK_DEBOUNCE);
    });
    
    // Real-time UID validation on blur
    elements.uidInput.addEventListener('blur', (e) => {
        validateUID(e.target.value);
        updateFormValidity();
    });
    
    // Badge name validation
    elements.badgeNameInput.addEventListener('input', (e) => {
        validateBadgeName(e.target.value);
        updateCharacterCount(e.target.value);
        updateFormValidity();
    });
    
    elements.badgeNameInput.addEventListener('blur', (e) => {
        validateBadgeName(e.target.value);
        updateFormValidity();
    });
    
    // Template selection handler (delegated)
    elements.templateGrid.addEventListener('change', handleTemplateSelection);
    
    // Update form validity on any input change
    elements.form.addEventListener('input', updateFormValidity);
    elements.form.addEventListener('change', updateFormValidity);
}

// Load available templates
async function loadTemplates() {
    try {
        showTemplateLoading(true);
        const response = await fetch('/api/templates');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const templates = await response.json();
        appState.templates = templates;
        renderTemplates(templates);
        
    } catch (error) {
        console.error('Failed to load templates:', error);
        showTemplateError('Failed to load badge templates. Please refresh the page.');
    } finally {
        showTemplateLoading(false);
    }
}

// Load used UIDs from current session
async function loadUsedUIDs() {
    try {
        const response = await fetch('/api/queue');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const queueData = await response.json();
        appState.usedUIDs = new Set(queueData.jobs.map(job => job.uid));
        
    } catch (error) {
        console.error('Failed to load used UIDs:', error);
        // Continue without UID checking if this fails
    }
}

// Render templates in the grid
function renderTemplates(templates) {
    const templateTemplate = document.getElementById('template-item-template');
    
    if (templates.length === 0) {
        elements.templateGrid.innerHTML = '<div class="template-loading">No templates available</div>';
        return;
    }
    
    elements.templateGrid.innerHTML = '';
    
    templates.forEach((template, index) => {
        const templateElement = templateTemplate.content.cloneNode(true);
        const radio = templateElement.querySelector('.template-radio');
        const label = templateElement.querySelector('.template-label');
        const image = templateElement.querySelector('.template-image');
        const name = templateElement.querySelector('.template-name');
        
        const radioId = `template-${template.id}`;
        radio.id = radioId;
        radio.value = template.id;
        label.setAttribute('for', radioId);
        
        image.src = template.previewPath || '/images/template-placeholder.png';
        image.alt = `Preview of ${template.name} template`;
        name.textContent = template.name;
        
        elements.templateGrid.appendChild(templateElement);
    });
    
    updateFormValidity();
}

// Handle template selection
function handleTemplateSelection(event) {
    if (event.target.type === 'radio' && event.target.name === 'template') {
        const templateId = event.target.value;
        const template = appState.templates.find(t => t.id === templateId);
        
        if (template) {
            appState.selectedTemplate = template;
            updateTemplatePreview(template);
            updateFormValidity();
        }
    }
}

// Update template preview (placeholder for future enhancement)
function updateTemplatePreview(template) {
    // This could be enhanced to show a larger preview or update form fields
    console.log('Selected template:', template.name);
}

// Validate UID with uniqueness checking
function validateUID(uid) {
    // Handle null/undefined inputs
    if (uid == null || typeof uid !== 'string') {
        showFieldError('uid', CONFIG.VALIDATION_MESSAGES.UID_REQUIRED);
        if (elements.uidInput) elements.uidInput.setAttribute('aria-invalid', 'true');
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
    else if (appState.usedUIDs.has(trimmedUID)) {
        errorMessage = CONFIG.VALIDATION_MESSAGES.UID_DUPLICATE;
        isValid = false;
    }
    
    // Show error if invalid
    if (!isValid) {
        showFieldError('uid', errorMessage);
        if (elements.uidInput) elements.uidInput.setAttribute('aria-invalid', 'true');
    } else {
        if (elements.uidInput) elements.uidInput.setAttribute('aria-invalid', 'false');
    }
    
    return isValid;
}

// Validate badge name
function validateBadgeName(badgeName) {
    // Handle null/undefined inputs
    if (badgeName == null || typeof badgeName !== 'string') {
        showFieldError('badgeName', CONFIG.VALIDATION_MESSAGES.BADGE_NAME_REQUIRED);
        if (elements.badgeNameInput) elements.badgeNameInput.setAttribute('aria-invalid', 'true');
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
        if (elements.badgeNameInput) elements.badgeNameInput.setAttribute('aria-invalid', 'true');
    } else {
        if (elements.badgeNameInput) elements.badgeNameInput.setAttribute('aria-invalid', 'false');
    }
    
    return isValid;
}

// Update character count display
function updateCharacterCount(text) {
    const helpText = document.getElementById('badge-name-help');
    const remaining = CONFIG.MAX_BADGE_NAME_LENGTH - text.length;
    const baseText = `Enter the name to display on the badge (max ${CONFIG.MAX_BADGE_NAME_LENGTH} characters)`;
    
    if (text.length > 0) {
        helpText.textContent = `${baseText} - ${remaining} characters remaining`;
        if (remaining < 10) {
            helpText.style.color = remaining < 0 ? '#e74c3c' : '#f39c12';
        } else {
            helpText.style.color = '#7f8c8d';
        }
    } else {
        helpText.textContent = baseText;
        helpText.style.color = '#7f8c8d';
    }
}

// Show field-specific error messages
function showFieldError(fieldName, message) {
    const errorElement = fieldName === 'uid' ? elements.uidError : elements.badgeNameError;
    errorElement.textContent = message;
    errorElement.style.display = message ? 'block' : 'none';
}

// Update form validity and submit button state
function updateFormValidity() {
    const uidValue = elements.uidInput ? elements.uidInput.value : '';
    const badgeNameValue = elements.badgeNameInput ? elements.badgeNameInput.value : '';
    
    const uidValid = validateUID(uidValue);
    const badgeNameValid = validateBadgeName(badgeNameValue);
    const templateSelected = appState.selectedTemplate !== null;
    
    const isFormValid = uidValid && badgeNameValid && templateSelected && !appState.isSubmitting;
    
    if (elements.submitButton) {
        elements.submitButton.disabled = !isFormValid;
    }
    
    // Show template selection error if needed
    if (!templateSelected && (uidValue || badgeNameValue)) {
        showGlobalError(CONFIG.VALIDATION_MESSAGES.TEMPLATE_REQUIRED);
    } else {
        hideGlobalError();
    }
}

// Handle form submission
async function handleFormSubmit(event) {
    event.preventDefault();
    
    if (appState.isSubmitting) {
        return;
    }
    
    // Final validation
    const uidValid = validateUID(elements.uidInput.value);
    const badgeNameValid = validateBadgeName(elements.badgeNameInput.value);
    
    if (!uidValid || !badgeNameValid || !appState.selectedTemplate) {
        showGlobalError('Please fix the errors above before submitting.');
        return;
    }
    
    // Prepare form data
    const formData = {
        templateId: appState.selectedTemplate.id,
        uid: elements.uidInput.value.trim(),
        badgeName: elements.badgeNameInput.value.trim()
    };
    
    try {
        appState.isSubmitting = true;
        updateSubmitButtonState(true);
        
        const response = await fetch('/api/badges', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        // Add UID to used set
        appState.usedUIDs.add(formData.uid);
        
        // Show success message
        showSuccessMessage(`Badge job created successfully! Job ID: ${result.jobId}`);
        
        // Reset form
        handleFormReset();
        
    } catch (error) {
        console.error('Form submission error:', error);
        showGlobalError(`Failed to create badge job: ${error.message}`);
    } finally {
        appState.isSubmitting = false;
        updateSubmitButtonState(false);
    }
}

// Handle form reset
function handleFormReset() {
    appState.selectedTemplate = null;
    
    // Clear error messages
    showFieldError('uid', '');
    showFieldError('badgeName', '');
    hideGlobalError();
    
    // Reset character count
    updateCharacterCount('');
    
    // Reset ARIA attributes
    elements.uidInput.removeAttribute('aria-invalid');
    elements.badgeNameInput.removeAttribute('aria-invalid');
    
    // Update form validity
    updateFormValidity();
}

// Update submit button loading state
function updateSubmitButtonState(isLoading) {
    elements.submitButton.classList.toggle('loading', isLoading);
    elements.submitButton.disabled = isLoading || !isFormValid();
}

// Check if form is valid
function isFormValid() {
    const uidValid = elements.uidInput.value.trim() && 
                    !appState.usedUIDs.has(elements.uidInput.value.trim()) &&
                    /^[a-zA-Z0-9-]+$/.test(elements.uidInput.value.trim());
    
    const badgeNameValid = elements.badgeNameInput.value.trim() && 
                          elements.badgeNameInput.value.trim().length <= CONFIG.MAX_BADGE_NAME_LENGTH;
    
    const templateSelected = appState.selectedTemplate !== null;
    
    return uidValid && badgeNameValid && templateSelected;
}

// Show/hide template loading state
function showTemplateLoading(isLoading) {
    if (isLoading) {
        elements.templateGrid.innerHTML = '<div class="template-loading">Loading templates...</div>';
    }
}

// Show template error
function showTemplateError(message) {
    elements.templateGrid.innerHTML = `<div class="template-loading" style="color: #e74c3c;">${message}</div>`;
}

// Show global error message
function showGlobalError(message) {
    // Create or update global error display
    let errorDiv = document.querySelector('.global-error');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.className = 'global-error';
        errorDiv.style.cssText = `
            background: #fee;
            border: 1px solid #fcc;
            color: #c33;
            padding: 12px;
            border-radius: 4px;
            margin-bottom: 20px;
            font-size: 0.9rem;
        `;
        elements.form.insertBefore(errorDiv, elements.form.firstChild);
    }
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    errorDiv.setAttribute('role', 'alert');
}

// Hide global error message
function hideGlobalError() {
    const errorDiv = document.querySelector('.global-error');
    if (errorDiv) {
        errorDiv.style.display = 'none';
    }
}

// Show success message
function showSuccessMessage(message) {
    // Create or update success display
    let successDiv = document.querySelector('.global-success');
    if (!successDiv) {
        successDiv = document.createElement('div');
        successDiv.className = 'global-success';
        successDiv.style.cssText = `
            background: #efe;
            border: 1px solid #cfc;
            color: #363;
            padding: 12px;
            border-radius: 4px;
            margin-bottom: 20px;
            font-size: 0.9rem;
        `;
        elements.form.insertBefore(successDiv, elements.form.firstChild);
    }
    successDiv.textContent = message;
    successDiv.style.display = 'block';
    successDiv.setAttribute('role', 'alert');
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        if (successDiv) {
            successDiv.style.display = 'none';
        }
    }, 5000);
}

// Update connection status
function updateConnectionStatus(isConnected) {
    elements.connectionStatus.textContent = isConnected ? 'Connected' : 'Disconnected';
    elements.connectionStatus.className = isConnected ? 'connected' : 'disconnected';
    
    elements.statusIndicator.className = `status-indicator ${isConnected ? 'connected' : 'disconnected'}`;
    elements.statusText.textContent = isConnected ? 'Printer ready' : 'Connection lost';
}

// Export functions for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        validateUID,
        validateBadgeName,
        updateCharacterCount,
        isFormValid,
        CONFIG
    };
}