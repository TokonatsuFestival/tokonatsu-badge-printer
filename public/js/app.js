// Festival Badge Printer Client-side JavaScript

// Initialize Socket.io connection
const socket = io();

// Application state
const appState = {
    templates: [],
    selectedTemplate: null,
    usedUIDs: new Set(),
    isSubmitting: false,
    queueStatus: {
        stats: { queued: 0, processing: 0, completed: 0, failed: 0, total: 0 },
        queuedJobs: [],
        processingJobs: [],
        currentJob: null,
        isProcessing: false
    },
    connectionRetryCount: 0
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
    // Request initial queue status when connected
    loadQueueStatus();
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    updateConnectionStatus(false);
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    updateConnectionStatus(false);
});

// Real-time queue update handlers
socket.on('queueUpdate', (queueStatus) => {
    console.log('Queue update received:', queueStatus);
    updateQueueDisplay(queueStatus);
});

socket.on('jobStatusChange', (jobData) => {
    console.log('Job status change:', jobData);
    updateJobStatus(jobData);
    showJobNotification(jobData);
});

// Handle reconnection
socket.on('reconnect', (attemptNumber) => {
    console.log('Reconnected after', attemptNumber, 'attempts');
    updateConnectionStatus(true);
    loadQueueStatus();
});

socket.on('reconnect_error', (error) => {
    console.error('Reconnection error:', error);
});

socket.on('reconnect_failed', () => {
    console.error('Failed to reconnect');
    showGlobalError('Connection lost. Please refresh the page.');
});

// Auto-reconnect to saved printer
async function autoReconnectPrinter() {
    try {
        const savedPrinter = localStorage.getItem('selectedPrinter');
        if (savedPrinter) {
            const printer = JSON.parse(savedPrinter);
            // Try to reconnect if saved within last 24 hours
            if (Date.now() - printer.connectedAt < 24 * 60 * 60 * 1000) {
                await connectToPrinter(printer.id);
            }
        }
    } catch (error) {
        console.log('Auto-reconnect failed:', error.message);
    }
}

// DOM ready handler
document.addEventListener('DOMContentLoaded', () => {
    console.log('Festival Badge Printer initialized');
    initializeElements();
    initializeFormHandlers();
    loadTemplates();
    loadBadgeImages();
    autoReconnectPrinter();
    loadUsedUIDs();
    loadQueueStatus();
    checkInitialPrinterStatus();
    
    // Setup printer modal button
    const setupButton = document.getElementById('printer-setup-btn');
    if (setupButton) {
        setupButton.onclick = function(e) {
            e.preventDefault();
            showPrinterSetupModal();
        };
    }
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
        statusText: document.getElementById('status-text'),
        queueCount: document.getElementById('queue-count'),
        processingCount: document.getElementById('processing-count'),
        completedCount: document.getElementById('completed-count'),
        jobList: document.getElementById('job-list'),
        refreshQueue: document.getElementById('refresh-queue')
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
            generateLiveBadgePreview();
        }, CONFIG.UID_CHECK_DEBOUNCE);
    });
    
    // Real-time UID validation on blur
    elements.uidInput.addEventListener('blur', (e) => {
        validateUID(e.target.value);
        updateFormValidity();
    });
    
    // Badge name validation
    let badgeNameTimeout;
    elements.badgeNameInput.addEventListener('input', (e) => {
        validateBadgeName(e.target.value);
        updateCharacterCount(e.target.value);
        updateFormValidity();
        
        // Debounce live preview generation
        clearTimeout(badgeNameTimeout);
        badgeNameTimeout = setTimeout(() => {
            generateLiveBadgePreview();
        }, CONFIG.UID_CHECK_DEBOUNCE);
    });
    
    elements.badgeNameInput.addEventListener('blur', (e) => {
        validateBadgeName(e.target.value);
        updateFormValidity();
    });
    
    // Template selection handler (delegated)
    elements.templateGrid.addEventListener('change', handleTemplateSelection);
    
    // Queue refresh button
    elements.refreshQueue.addEventListener('click', loadQueueStatus);
    
    // Job history button
    const viewHistoryButton = document.getElementById('view-history');
    if (viewHistoryButton) {
        viewHistoryButton.addEventListener('click', showJobHistoryModal);
    }
    

    
    // Job list event delegation for cancel/retry/intervention buttons
    elements.jobList.addEventListener('click', handleJobAction);
    
    // Update form validity on any input change
    elements.form.addEventListener('input', updateFormValidity);
    elements.form.addEventListener('change', updateFormValidity);
}

// Load available badge images
async function loadBadgeImages() {
    try {
        const response = await fetch('/api/badge-images');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        const images = data.images || [];
        
        renderImageGrid(images);
        
    } catch (error) {
        console.error('Failed to load badge images:', error);
        const imageGrid = document.getElementById('image-grid');
        if (imageGrid) {
            imageGrid.innerHTML = '<div class="image-loading" style="color: #e74c3c;">Failed to load images</div>';
        }
    }
}

// Render image selection grid
function renderImageGrid(images) {
    const imageGrid = document.getElementById('image-grid');
    
    if (images.length === 0) {
        imageGrid.innerHTML = '<div class="image-loading">No images available</div>';
        return;
    }
    
    imageGrid.innerHTML = '';
    
    images.forEach((image, index) => {
        const imageItem = document.createElement('div');
        imageItem.className = 'image-item';
        
        const radioId = `image-${index}`;
        imageItem.innerHTML = `
            <input type="radio" name="badgeImage" class="image-radio" id="${radioId}" value="${image.filename}">
            <label class="image-label" for="${radioId}">
                <div class="image-preview">
                    <img src="${image.path}" alt="${image.name}" class="badge-image">
                </div>
                <div class="image-info">
                    <span class="image-name">${image.name}</span>
                </div>
            </label>
        `;
        
        imageGrid.appendChild(imageItem);
    });
    
    // Auto-select first image
    if (images.length > 0) {
        const firstImage = images[0];
        const firstRadio = document.querySelector(`#image-0`);
        if (firstRadio) {
            firstRadio.checked = true;
            appState.selectedImage = firstImage.filename;
            
            // Update visual feedback
            const firstImageItem = firstRadio.closest('.image-item');
            if (firstImageItem) {
                firstImageItem.classList.add('selected');
            }
        }
    }
    
    // Add event listener for image selection
    imageGrid.addEventListener('change', handleImageSelection);
}

// Handle image selection
function handleImageSelection(event) {
    if (event.target.type === 'radio' && event.target.name === 'badgeImage') {
        const selectedImage = event.target.value;
        appState.selectedImage = selectedImage;
        
        // Update visual feedback
        const imageItems = document.querySelectorAll('.image-item');
        imageItems.forEach(item => {
            const radio = item.querySelector('.image-radio');
            if (radio && radio.value === selectedImage) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });
        
        updateFormValidity();
        generateLiveBadgePreview();
        updateTemplateImages();
        
        // Update visual editor if open
        if (visualEditor.canvas) {
            loadBadgeImageForEditor();
        }
    }
}

// Update template preview images with selected background
function updateTemplateImages() {
    const templateImages = document.querySelectorAll('.template-image');
    templateImages.forEach(image => {
        const templateId = image.closest('.template-item').querySelector('.template-radio').value;
        const imageParam = appState.selectedImage ? `?badgeImage=${appState.selectedImage}` : '';
        image.src = `/api/templates/${templateId}/preview${imageParam}`;
    });
}

// Load available templates
async function loadTemplates() {
    try {
        showTemplateLoading(true);
        const response = await fetch('/api/templates');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        const templates = data.templates || [];
        appState.templates = Array.isArray(templates) ? templates : [];
        renderTemplates(appState.templates);
        
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
        const jobs = queueData.jobs || [];
        appState.usedUIDs = new Set(jobs.map(job => job.uid));
        
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
        
        // Use dynamic preview endpoint with selected image
        const imageParam = appState.selectedImage ? `?badgeImage=${appState.selectedImage}` : '';
        image.src = `/api/templates/${template.id}/preview${imageParam}`;
        image.alt = `Preview of ${template.name} template`;
        image.onerror = function() {
            this.style.display = 'none';
        };
        
        name.textContent = template.name;
        
        // Add template validation indicator
        const validationIndicator = document.createElement('div');
        validationIndicator.className = 'template-validation';
        validationIndicator.innerHTML = '<span class="validation-status">Validating...</span>';
        templateElement.querySelector('.template-info').appendChild(validationIndicator);
        
        // Validate template asynchronously
        validateTemplateAsync(template.id, validationIndicator);
        
        elements.templateGrid.appendChild(templateElement);
    });
    
    // Auto-select first template and hide section if only one template
    if (templates.length === 1) {
        const template = templates[0];
        const firstRadio = document.querySelector(`#template-${template.id}`);
        if (firstRadio) {
            firstRadio.checked = true;
            appState.selectedTemplate = template;
            updateTemplatePreview(template);
        }
        // Hide template selection section
        const templateSection = document.querySelector('.form-section:has(.template-selection)');
        if (templateSection) {
            templateSection.style.display = 'none';
        }
    } else if (templates.length > 1) {
        const firstTemplate = templates[0];
        const firstRadio = document.querySelector(`#template-${firstTemplate.id}`);
        if (firstRadio) {
            firstRadio.checked = true;
            appState.selectedTemplate = firstTemplate;
            updateTemplatePreview(firstTemplate);
        }
    }
    
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
            
            // Generate live preview if form has data
            generateLiveBadgePreview();
        }
    }
}

// Update template preview (placeholder for future enhancement)
function updateTemplatePreview(template) {
    // This could be enhanced to show a larger preview or update form fields
    console.log('Selected template:', template.name);
    
    // Add visual feedback for selected template
    const templateItems = document.querySelectorAll('.template-item');
    templateItems.forEach(item => {
        const radio = item.querySelector('.template-radio');
        if (radio && radio.value === template.id) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });
}

// Validate template asynchronously
async function validateTemplateAsync(templateId, indicatorElement) {
    try {
        const response = await fetch(`/api/templates/${templateId}/validate`, {
            method: 'POST'
        });
        
        if (response.ok) {
            const data = await response.json();
            const validation = data.validation;
            
            if (validation.isValid) {
                indicatorElement.innerHTML = '<span class="validation-status valid">✓ Valid</span>';
                indicatorElement.className = 'template-validation valid';
            } else {
                indicatorElement.innerHTML = `<span class="validation-status invalid">✗ ${validation.error}</span>`;
                indicatorElement.className = 'template-validation invalid';
            }
        } else {
            indicatorElement.innerHTML = '<span class="validation-status error">Validation failed</span>';
            indicatorElement.className = 'template-validation error';
        }
    } catch (error) {
        console.error('Template validation error:', error);
        indicatorElement.innerHTML = '<span class="validation-status error">Validation error</span>';
        indicatorElement.className = 'template-validation error';
    }
}

// Generate live badge preview
async function generateLiveBadgePreview() {
    if (!appState.selectedTemplate) {
        return;
    }
    
    const uidValue = elements.uidInput.value.trim();
    const badgeNameValue = elements.badgeNameInput.value.trim();
    
    // Only generate preview if both fields have valid data
    if (!uidValue || !badgeNameValue) {
        return;
    }
    
    // Check if we already have a preview container
    let previewContainer = document.getElementById('live-preview-container');
    if (!previewContainer) {
        previewContainer = document.createElement('div');
        previewContainer.id = 'live-preview-container';
        previewContainer.className = 'live-preview-container';
        previewContainer.innerHTML = `
            <h4>Badge Preview</h4>
            <div class="preview-content">
                <img id="live-preview-image" alt="Badge preview" />
                <div class="preview-loading">Generating preview...</div>
            </div>
        `;
        
        // Insert after the badge form
        const badgeForm = document.getElementById('badge-form');
        badgeForm.parentNode.insertBefore(previewContainer, badgeForm.nextSibling);
    }
    
    const previewImage = document.getElementById('live-preview-image');
    const previewLoading = previewContainer.querySelector('.preview-loading');
    
    try {
        previewLoading.style.display = 'block';
        previewImage.style.display = 'none';
        
        const response = await fetch('/api/badges/preview', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                templateId: appState.selectedTemplate.id,
                uid: uidValue,
                badgeName: badgeNameValue,
                badgeImage: appState.selectedImage
            })
        });
        
        if (response.ok) {
            const blob = await response.blob();
            const imageUrl = URL.createObjectURL(blob);
            
            previewImage.src = imageUrl;
            previewImage.onload = () => {
                previewLoading.style.display = 'none';
                previewImage.style.display = 'block';
            };
            
            // Clean up previous blob URL
            if (previewImage.dataset.blobUrl) {
                URL.revokeObjectURL(previewImage.dataset.blobUrl);
            }
            previewImage.dataset.blobUrl = imageUrl;
            
        } else {
            throw new Error(`Preview generation failed: ${response.status}`);
        }
        
    } catch (error) {
        console.error('Live preview error:', error);
        previewLoading.textContent = 'Preview unavailable';
        previewImage.style.display = 'none';
    }
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
    // Uniqueness validation temporarily disabled
    // else if (appState.usedUIDs.has(trimmedUID)) {
    //     errorMessage = CONFIG.VALIDATION_MESSAGES.UID_DUPLICATE;
    //     isValid = false;
    // }
    
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
        badgeName: elements.badgeNameInput.value.trim(),
        badgeImage: appState.selectedImage
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
        const jobId = result.jobId || result.id || Date.now().toString();
        showSuccessMessage(`Badge job created successfully! Job ID: ${jobId}`);
        
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
    // Keep template and image selection, only clear input fields
    elements.uidInput.value = '';
    elements.badgeNameInput.value = '';
    
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
    
    // Regenerate live preview with empty inputs if template is selected
    if (appState.selectedTemplate && appState.selectedImage) {
        generateLiveBadgePreview();
    }
}

// Update submit button loading state
function updateSubmitButtonState(isLoading) {
    elements.submitButton.classList.toggle('loading', isLoading);
    elements.submitButton.disabled = isLoading || !isFormValid();
}

// Check if form is valid
function isFormValid() {
    const uidValid = elements.uidInput.value.trim() && 
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
function updateConnectionStatus(isConnected, statusText = null) {
    elements.connectionStatus.textContent = isConnected ? 'Connected' : 'Disconnected';
    elements.connectionStatus.className = isConnected ? 'connected' : 'disconnected';
    
    elements.statusIndicator.className = `status-indicator ${isConnected ? 'connected' : 'disconnected'}`;
    elements.statusText.textContent = statusText || (isConnected ? 'Printer ready' : 'Checking printer connection...');
    
    // Update retry count for connection status
    if (isConnected) {
        appState.connectionRetryCount = 0;
    } else {
        appState.connectionRetryCount++;
    }
}

// Check printer status on page load
async function checkInitialPrinterStatus() {
    try {
        const response = await fetch('/api/printers/status');
        
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.status) {
                const status = data.status;
                updateConnectionStatus(status.isConnected, 
                    status.isConnected ? `Connected to ${status.printerName || status.printerId}` : 'No printer connected');
            } else {
                // No printer configured yet
                updateConnectionStatus(false, 'No printer configured');
            }
        } else {
            // API call failed, show checking status
            updateConnectionStatus(false, 'Checking printer connection...');
        }
    } catch (error) {
        console.log('Could not check initial printer status:', error.message);
        // Show checking status when there's an error
        updateConnectionStatus(false, 'Checking printer connection...');
    }
}

// Load current queue status
async function loadQueueStatus() {
    try {
        const response = await fetch('/api/queue');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const queueStatus = await response.json();
        appState.queueStatus = queueStatus;
        updateQueueDisplay(queueStatus);
        
    } catch (error) {
        console.error('Failed to load queue status:', error);
        // Don't show error if we're disconnected - the connection status will handle it
        if (socket.connected) {
            showGlobalError('Failed to load queue status. Please try refreshing.');
        }
    }
}

// Update queue display with real-time data
function updateQueueDisplay(queueStatus) {
    // Update queue statistics
    const stats = queueStatus.stats || {};
    elements.queueCount.textContent = stats.queued || 0;
    elements.processingCount.textContent = stats.processing || 0;
    elements.completedCount.textContent = stats.completed || 0;
    
    // Combine all jobs for display
    const allJobs = [
        ...(queueStatus.queuedJobs || []),
        ...(queueStatus.processingJobs || [])
    ];
    
    // Add current job if it exists and isn't already in the list
    if (queueStatus.currentJob && !allJobs.find(job => job.id === queueStatus.currentJob.id)) {
        allJobs.unshift(queueStatus.currentJob);
    }
    
    // Sort jobs by creation time (newest first)
    allJobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    renderJobList(allJobs);
    
    // Update used UIDs from current jobs
    const currentUIDs = allJobs
        .filter(job => job.status !== 'failed' && job.status !== 'completed')
        .map(job => job.uid);
    appState.usedUIDs = new Set(currentUIDs);
}

// Render the job list
function renderJobList(jobs) {
    const jobTemplate = document.getElementById('job-item-template');
    
    if (jobs.length === 0) {
        elements.jobList.innerHTML = '<div class="empty-queue"><p>No jobs in queue</p></div>';
        return;
    }
    
    elements.jobList.innerHTML = '';
    
    jobs.forEach(job => {
        const jobElement = jobTemplate.content.cloneNode(true);
        const jobItem = jobElement.querySelector('.job-item');
        
        // Set job data
        jobItem.setAttribute('data-job-id', job.id);
        jobElement.querySelector('.job-uid').textContent = job.uid;
        jobElement.querySelector('.job-name').textContent = job.badgeName;
        jobElement.querySelector('.job-template').textContent = getTemplateName(job.templateId);
        jobElement.querySelector('.job-timestamp').textContent = formatTimestamp(job.createdAt);
        
        // Set status with appropriate styling
        const statusElement = jobElement.querySelector('.job-status');
        statusElement.textContent = formatJobStatus(job.status);
        statusElement.className = `job-status status-${job.status}`;
        
        // Configure action buttons
        const cancelButton = jobElement.querySelector('.job-cancel');
        const retryButton = jobElement.querySelector('.job-retry');
        
        // Add manual intervention button if not already present
        let interventionButton = jobElement.querySelector('.job-manual-intervention');
        if (!interventionButton) {
            interventionButton = document.createElement('button');
            interventionButton.className = 'btn btn-small btn-warning job-manual-intervention';
            interventionButton.setAttribute('aria-label', 'Manual intervention');
            interventionButton.textContent = 'Intervene';
            jobElement.querySelector('.job-actions').appendChild(interventionButton);
        }
        
        if (job.status === 'failed') {
            cancelButton.style.display = 'none';
            retryButton.style.display = 'inline-block';
            retryButton.disabled = job.retryCount >= 3; // Max retries
            interventionButton.style.display = 'inline-block';
        } else if (job.status === 'completed') {
            cancelButton.style.display = 'none';
            retryButton.style.display = 'none';
            interventionButton.style.display = 'none';
        } else if (job.status === 'processing') {
            cancelButton.style.display = 'inline-block';
            retryButton.style.display = 'none';
            interventionButton.style.display = 'inline-block';
        } else {
            cancelButton.style.display = 'inline-block';
            retryButton.style.display = 'none';
            interventionButton.style.display = 'none';
        }
        
        // Add error message if failed
        if (job.status === 'failed' && job.errorMessage) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'job-error';
            errorDiv.textContent = job.errorMessage;
            jobElement.querySelector('.job-info').appendChild(errorDiv);
        }
        
        elements.jobList.appendChild(jobElement);
    });
}

// Handle job action buttons (cancel/retry/manual intervention)
async function handleJobAction(event) {
    if (!event.target.matches('.job-cancel, .job-retry, .job-manual-intervention')) {
        return;
    }
    
    const jobItem = event.target.closest('.job-item');
    const jobId = jobItem.getAttribute('data-job-id');
    const jobUid = jobItem.querySelector('.job-uid').textContent;
    const jobName = jobItem.querySelector('.job-name').textContent;
    const isCancel = event.target.classList.contains('job-cancel');
    const isRetry = event.target.classList.contains('job-retry');
    const isManualIntervention = event.target.classList.contains('job-manual-intervention');
    
    try {
        event.target.disabled = true;
        
        if (isCancel) {
            const confirmed = await showConfirmationDialog(
                'Cancel Job',
                `Are you sure you want to cancel the badge job for "${jobName}" (UID: ${jobUid})?`,
                'This action cannot be undone.',
                'Cancel Job',
                'Keep Job'
            );
            
            if (!confirmed) {
                event.target.disabled = false;
                return;
            }
            
            const response = await fetch(`/api/jobs/${jobId}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || `Failed to cancel job: ${response.status}`);
            }
            
            showSuccessMessage('Job cancelled successfully');
            
        } else if (isRetry) {
            const confirmed = await showConfirmationDialog(
                'Retry Job',
                `Retry the failed badge job for "${jobName}" (UID: ${jobUid})?`,
                'The job will be added back to the queue for processing.',
                'Retry Job',
                'Cancel'
            );
            
            if (!confirmed) {
                event.target.disabled = false;
                return;
            }
            
            const response = await fetch(`/api/jobs/${jobId}/retry`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || `Failed to retry job: ${response.status}`);
            }
            
            showSuccessMessage('Job queued for retry');
            
        } else if (isManualIntervention) {
            await showManualInterventionDialog(jobId, jobUid, jobName);
            event.target.disabled = false;
            return;
        }
        
    } catch (error) {
        console.error('Job action error:', error);
        showGlobalError(error.message);
        event.target.disabled = false;
    }
}

// Update individual job status (for granular updates)
function updateJobStatus(jobData) {
    const jobItem = document.querySelector(`[data-job-id="${jobData.id}"]`);
    if (!jobItem) {
        // Job not currently displayed, refresh the whole queue
        loadQueueStatus();
        return;
    }
    
    // Update status display
    const statusElement = jobItem.querySelector('.job-status');
    statusElement.textContent = formatJobStatus(jobData.status);
    statusElement.className = `job-status status-${jobData.status}`;
    
    // Update action buttons
    const cancelButton = jobItem.querySelector('.job-cancel');
    const retryButton = jobItem.querySelector('.job-retry');
    
    if (jobData.status === 'failed') {
        cancelButton.style.display = 'none';
        retryButton.style.display = 'inline-block';
        retryButton.disabled = jobData.retryCount >= 3;
        
        // Add error message if not already present
        if (jobData.errorMessage && !jobItem.querySelector('.job-error')) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'job-error';
            errorDiv.textContent = jobData.errorMessage;
            jobItem.querySelector('.job-info').appendChild(errorDiv);
        }
    } else if (jobData.status === 'completed') {
        cancelButton.style.display = 'none';
        retryButton.style.display = 'none';
        
        // Remove error message if present
        const errorDiv = jobItem.querySelector('.job-error');
        if (errorDiv) {
            errorDiv.remove();
        }
    }
}

// Show job status change notifications
function showJobNotification(jobData) {
    const notifications = {
        'processing': `Processing badge for ${jobData.badgeName}`,
        'completed': `Badge completed for ${jobData.badgeName}`,
        'failed': `Badge failed for ${jobData.badgeName}: ${jobData.errorMessage || 'Unknown error'}`
    };
    
    const message = notifications[jobData.status];
    if (message) {
        showToastNotification(message, jobData.status);
    }
}

// Show toast notification
function showToastNotification(message, type = 'info') {
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'completed' ? '#2ecc71' : type === 'failed' ? '#e74c3c' : '#3498db'};
        color: white;
        padding: 12px 20px;
        border-radius: 4px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        z-index: 1000;
        max-width: 300px;
        word-wrap: break-word;
        opacity: 0;
        transform: translateX(100%);
        transition: all 0.3s ease;
    `;
    
    document.body.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
    }, 100);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 5000);
}

// Helper functions
function getTemplateName(templateId) {
    const template = appState.templates.find(t => t.id === templateId);
    return template ? template.name : 'Unknown Template';
}

function formatJobStatus(status) {
    const statusMap = {
        'queued': 'Queued',
        'processing': 'Processing',
        'completed': 'Completed',
        'failed': 'Failed'
    };
    return statusMap[status] || status;
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
}

// Show confirmation dialog
function showConfirmationDialog(title, message, details, confirmText, cancelText) {
    return new Promise((resolve) => {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;
        
        // Create modal dialog
        const modal = document.createElement('div');
        modal.className = 'confirmation-modal';
        modal.style.cssText = `
            background: white;
            border-radius: 8px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
            max-width: 400px;
            width: 90%;
            max-height: 90vh;
            overflow-y: auto;
        `;
        
        modal.innerHTML = `
            <div class="modal-header" style="padding: 20px 20px 0 20px;">
                <h3 style="margin: 0; color: #2c3e50; font-size: 1.2rem;">${title}</h3>
            </div>
            <div class="modal-body" style="padding: 15px 20px;">
                <p style="margin: 0 0 10px 0; color: #34495e; line-height: 1.5;">${message}</p>
                ${details ? `<p style="margin: 0; color: #7f8c8d; font-size: 0.9rem; line-height: 1.4;">${details}</p>` : ''}
            </div>
            <div class="modal-actions" style="padding: 0 20px 20px 20px; display: flex; gap: 10px; justify-content: flex-end;">
                <button class="btn btn-secondary modal-cancel" style="min-width: 80px;">${cancelText}</button>
                <button class="btn btn-danger modal-confirm" style="min-width: 80px;">${confirmText}</button>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        // Focus the confirm button
        const confirmButton = modal.querySelector('.modal-confirm');
        const cancelButton = modal.querySelector('.modal-cancel');
        
        setTimeout(() => confirmButton.focus(), 100);
        
        // Handle button clicks
        const handleConfirm = () => {
            document.body.removeChild(overlay);
            resolve(true);
        };
        
        const handleCancel = () => {
            document.body.removeChild(overlay);
            resolve(false);
        };
        
        confirmButton.addEventListener('click', handleConfirm);
        cancelButton.addEventListener('click', handleCancel);
        
        // Handle escape key
        const handleKeydown = (e) => {
            if (e.key === 'Escape') {
                handleCancel();
            } else if (e.key === 'Enter' && e.target === confirmButton) {
                handleConfirm();
            }
        };
        
        document.addEventListener('keydown', handleKeydown);
        
        // Cleanup function
        const cleanup = () => {
            document.removeEventListener('keydown', handleKeydown);
        };
        
        // Add cleanup to both handlers
        const originalHandleConfirm = handleConfirm;
        const originalHandleCancel = handleCancel;
        
        confirmButton.onclick = () => {
            cleanup();
            originalHandleConfirm();
        };
        
        cancelButton.onclick = () => {
            cleanup();
            originalHandleCancel();
        };
        
        // Handle overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                cleanup();
                handleCancel();
            }
        });
    });
}

// Show manual intervention dialog
async function showManualInterventionDialog(jobId, jobUid, jobName) {
    return new Promise((resolve) => {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;
        
        // Create modal dialog
        const modal = document.createElement('div');
        modal.className = 'intervention-modal';
        modal.style.cssText = `
            background: white;
            border-radius: 8px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
            max-width: 500px;
            width: 90%;
            max-height: 90vh;
            overflow-y: auto;
        `;
        
        modal.innerHTML = `
            <div class="modal-header" style="padding: 20px 20px 0 20px;">
                <h3 style="margin: 0; color: #2c3e50; font-size: 1.2rem;">Manual Intervention Required</h3>
            </div>
            <div class="modal-body" style="padding: 15px 20px;">
                <p style="margin: 0 0 15px 0; color: #34495e; line-height: 1.5;">
                    Job for "${jobName}" (UID: ${jobUid}) requires manual intervention.
                </p>
                <p style="margin: 0 0 20px 0; color: #7f8c8d; font-size: 0.9rem; line-height: 1.4;">
                    Choose an action to resolve this stuck job:
                </p>
                
                <div class="intervention-options" style="display: flex; flex-direction: column; gap: 10px;">
                    <label style="display: flex; align-items: center; padding: 10px; border: 2px solid #ecf0f1; border-radius: 6px; cursor: pointer; transition: border-color 0.2s;">
                        <input type="radio" name="intervention-action" value="reset" style="margin-right: 10px;">
                        <div>
                            <strong style="color: #2c3e50;">Reset to Queue</strong>
                            <div style="font-size: 0.85rem; color: #7f8c8d; margin-top: 2px;">
                                Reset the job status to queued for automatic retry
                            </div>
                        </div>
                    </label>
                    
                    <label style="display: flex; align-items: center; padding: 10px; border: 2px solid #ecf0f1; border-radius: 6px; cursor: pointer; transition: border-color 0.2s;">
                        <input type="radio" name="intervention-action" value="complete" style="margin-right: 10px;">
                        <div>
                            <strong style="color: #27ae60;">Mark as Completed</strong>
                            <div style="font-size: 0.85rem; color: #7f8c8d; margin-top: 2px;">
                                Manually mark the job as completed (if printed externally)
                            </div>
                        </div>
                    </label>
                    
                    <label style="display: flex; align-items: center; padding: 10px; border: 2px solid #ecf0f1; border-radius: 6px; cursor: pointer; transition: border-color 0.2s;">
                        <input type="radio" name="intervention-action" value="fail" style="margin-right: 10px;">
                        <div>
                            <strong style="color: #e74c3c;">Mark as Failed</strong>
                            <div style="font-size: 0.85rem; color: #7f8c8d; margin-top: 2px;">
                                Permanently mark the job as failed
                            </div>
                        </div>
                    </label>
                </div>
                
                <div style="margin-top: 15px;">
                    <label for="intervention-reason" style="display: block; font-weight: 500; color: #2c3e50; margin-bottom: 5px;">
                        Reason (optional):
                    </label>
                    <textarea 
                        id="intervention-reason" 
                        placeholder="Enter reason for manual intervention..."
                        style="width: 100%; padding: 8px 12px; border: 2px solid #ecf0f1; border-radius: 4px; font-size: 0.9rem; resize: vertical; min-height: 60px;"
                    ></textarea>
                </div>
            </div>
            <div class="modal-actions" style="padding: 0 20px 20px 20px; display: flex; gap: 10px; justify-content: flex-end;">
                <button class="btn btn-secondary modal-cancel">Cancel</button>
                <button class="btn btn-primary modal-apply" disabled>Apply Intervention</button>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        // Get elements
        const radioButtons = modal.querySelectorAll('input[name="intervention-action"]');
        const reasonTextarea = modal.querySelector('#intervention-reason');
        const applyButton = modal.querySelector('.modal-apply');
        const cancelButton = modal.querySelector('.modal-cancel');
        
        // Handle radio button selection
        radioButtons.forEach(radio => {
            radio.addEventListener('change', () => {
                applyButton.disabled = false;
                
                // Update label styling
                modal.querySelectorAll('label').forEach(label => {
                    label.style.borderColor = '#ecf0f1';
                    label.style.backgroundColor = 'white';
                });
                
                const selectedLabel = radio.closest('label');
                selectedLabel.style.borderColor = '#3498db';
                selectedLabel.style.backgroundColor = '#f8f9fa';
            });
        });
        
        // Handle apply button
        applyButton.addEventListener('click', async () => {
            const selectedAction = modal.querySelector('input[name="intervention-action"]:checked');
            if (!selectedAction) return;
            
            const action = selectedAction.value;
            const reason = reasonTextarea.value.trim();
            
            try {
                applyButton.disabled = true;
                applyButton.textContent = 'Applying...';
                
                const response = await fetch(`/api/jobs/${jobId}/manual-intervention`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ action, reason })
                });
                
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || `Failed to apply intervention: ${response.status}`);
                }
                
                const result = await response.json();
                showSuccessMessage(`Manual intervention applied: ${result.intervention.action}`);
                
                document.body.removeChild(overlay);
                resolve(true);
                
            } catch (error) {
                console.error('Manual intervention error:', error);
                showGlobalError(error.message);
                applyButton.disabled = false;
                applyButton.textContent = 'Apply Intervention';
            }
        });
        
        // Handle cancel button
        cancelButton.addEventListener('click', () => {
            document.body.removeChild(overlay);
            resolve(false);
        });
        
        // Handle escape key
        const handleKeydown = (e) => {
            if (e.key === 'Escape') {
                document.body.removeChild(overlay);
                resolve(false);
            }
        };
        
        document.addEventListener('keydown', handleKeydown);
        
        // Handle overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
                resolve(false);
            }
        });
        
        // Cleanup on modal removal
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && !document.body.contains(overlay)) {
                    document.removeEventListener('keydown', handleKeydown);
                    observer.disconnect();
                }
            });
        });
        
        observer.observe(document.body, { childList: true });
    });
}

// Load job history
async function loadJobHistory(status = null, limit = 50, offset = 0) {
    try {
        let url = `/api/jobs/history?limit=${limit}&offset=${offset}`;
        if (status) {
            url += `&status=${status}`;
        }
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        return data;
        
    } catch (error) {
        console.error('Failed to load job history:', error);
        throw error;
    }
}

// Show job history modal
async function showJobHistoryModal() {
    try {
        const historyData = await loadJobHistory();
        
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;
        
        // Create modal dialog
        const modal = document.createElement('div');
        modal.className = 'history-modal';
        modal.style.cssText = `
            background: white;
            border-radius: 8px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
            max-width: 800px;
            width: 90%;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
        `;
        
        const jobsHtml = historyData.jobs.map(job => `
            <div class="history-job-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #ecf0f1;">
                <div style="flex: 1;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <span style="font-weight: 600; color: #2c3e50; font-family: 'Courier New', monospace;">${job.uid}</span>
                        <span class="job-status status-${job.status}" style="padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 500; text-transform: uppercase;">
                            ${formatJobStatus(job.status)}
                        </span>
                    </div>
                    <div style="font-size: 0.9rem; color: #7f8c8d; margin-bottom: 2px;">
                        <span style="font-weight: 500;">${job.badgeName}</span>
                    </div>
                    <div style="font-size: 0.8rem; color: #95a5a6;">
                        ${job.processedAt ? formatTimestamp(job.processedAt) : formatTimestamp(job.createdAt)}
                        ${job.retryCount > 0 ? ` • ${job.retryCount} retries` : ''}
                    </div>
                    ${job.errorMessage ? `<div style="font-size: 0.8rem; color: #e74c3c; background: #fdf2f2; padding: 4px 8px; border-radius: 4px; margin-top: 4px; border-left: 3px solid #e74c3c;">${job.errorMessage}</div>` : ''}
                </div>
            </div>
        `).join('');
        
        modal.innerHTML = `
            <div class="modal-header" style="padding: 20px; border-bottom: 1px solid #ecf0f1;">
                <h3 style="margin: 0; color: #2c3e50; font-size: 1.3rem;">Job History</h3>
                <p style="margin: 5px 0 0 0; color: #7f8c8d; font-size: 0.9rem;">
                    Showing ${historyData.jobs.length} of ${historyData.pagination.total} completed and failed jobs
                </p>
            </div>
            <div class="modal-body" style="flex: 1; overflow-y: auto; min-height: 200px;">
                ${historyData.jobs.length > 0 ? jobsHtml : '<div style="padding: 40px; text-align: center; color: #7f8c8d; font-style: italic;">No job history available</div>'}
            </div>
            <div class="modal-actions" style="padding: 20px; border-top: 1px solid #ecf0f1; display: flex; justify-content: flex-end;">
                <button class="btn btn-secondary modal-close">Close</button>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        // Handle close button
        modal.querySelector('.modal-close').addEventListener('click', () => {
            document.body.removeChild(overlay);
        });
        
        // Handle escape key and overlay click
        const handleClose = (e) => {
            if (e.key === 'Escape' || e.target === overlay) {
                document.body.removeChild(overlay);
                document.removeEventListener('keydown', handleClose);
            }
        };
        
        document.addEventListener('keydown', handleClose);
        overlay.addEventListener('click', handleClose);
        
    } catch (error) {
        console.error('Failed to show job history:', error);
        showGlobalError('Failed to load job history');
    }
}

// Export functions for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        validateUID,
        validateBadgeName,
        updateCharacterCount,
        isFormValid,
        showConfirmationDialog,
        loadJobHistory,
        CONFIG
    };
}
// Printer Setup Modal Functions
function showPrinterSetupModal() {
    const modal = document.getElementById('printer-setup-modal');
    const overlay = document.getElementById('printer-setup-overlay');
    const closeButton = document.getElementById('printer-setup-close');
    
    if (!modal) {
        return;
    }
    // Show modal with proper styling
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    modal.style.display = 'flex';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.zIndex = '10000';
    
    // Initialize modal content
    initializePrinterSetupModal();
    loadCurrentTextPositions();
    
    // Event handlers
    const closeModal = () => {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        modal.style.display = 'none';
        modal.style.position = '';
        modal.style.top = '';
        modal.style.left = '';
        modal.style.width = '';
        modal.style.height = '';
        modal.style.zIndex = '';
    };
    
    if (overlay) {
        overlay.addEventListener('click', closeModal);
    } else {
        console.error('Modal overlay not found');
    }
    
    if (closeButton) {
        closeButton.addEventListener('click', closeModal);
    } else {
        console.error('Modal close button not found');
    }
    
    // Handle escape key
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
    
    // Tab navigation
    const tabButtons = modal.querySelectorAll('.tab-button');
    const tabPanels = modal.querySelectorAll('.tab-panel');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');
            
            // Update active tab button
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // Update active tab panel
            tabPanels.forEach(panel => panel.classList.remove('active'));
            document.getElementById(`${targetTab}-panel`).classList.add('active');
            
            // Load tab content
            loadTabContent(targetTab);
        });
    });
    
    // Load initial tab content
    loadTabContent('discovery');
}

function initializePrinterSetupModal() {
    // Initialize discovery tab handlers
    const discoverButton = document.getElementById('discover-printers');
    const refreshButton = document.getElementById('refresh-printers');
    
    if (discoverButton) {
        discoverButton.addEventListener('click', discoverPrinters);
    }
    
    if (refreshButton) {
        refreshButton.addEventListener('click', discoverPrinters);
    }
    
    // Initialize status tab handlers
    const testButton = document.getElementById('test-connectivity');
    const refreshStatusButton = document.getElementById('refresh-status');
    const disconnectButton = document.getElementById('disconnect-printer');
    
    if (testButton) {
        testButton.addEventListener('click', testPrinterConnectivity);
    }
    
    if (refreshStatusButton) {
        refreshStatusButton.addEventListener('click', loadPrinterStatus);
    }
    
    if (disconnectButton) {
        disconnectButton.addEventListener('click', disconnectPrinter);
    }
    
    // Initialize text positioning handlers
    const updatePositionsButton = document.getElementById('update-positions');
    const resetPositionsButton = document.getElementById('reset-positions');
    
    if (updatePositionsButton) {
        updatePositionsButton.addEventListener('click', updateTextPositions);
    }
    
    if (resetPositionsButton) {
        resetPositionsButton.addEventListener('click', resetTextPositions);
    }
    
    // Initialize visual editor
    initializeVisualEditor();
}

function loadTabContent(tabName) {
    switch (tabName) {
        case 'discovery':
            // Discovery tab is loaded on demand when user clicks discover
            break;
        case 'status':
            loadPrinterStatus();
            break;
        case 'presets':
            loadPrinterPresets();
            break;
        case 'text-positioning':
            initializeVisualEditor();
            break;
        case 'troubleshooting':
            // Static content, no loading needed
            break;
    }
}

async function discoverPrinters() {
    const discoverButton = document.getElementById('discover-printers');
    const printerList = document.getElementById('printer-list');
    
    try {
        // Update button state
        discoverButton.classList.add('loading');
        discoverButton.disabled = true;
        
        // Show loading state
        printerList.innerHTML = '<div class="printer-loading">Discovering printers...</div>';
        
        const response = await fetch('/api/printers');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            renderPrinterList(data.printers);
        } else {
            throw new Error(data.message || 'Failed to discover printers');
        }
        
    } catch (error) {
        console.error('Printer discovery error:', error);
        printerList.innerHTML = `<div class="printer-loading" style="color: #e74c3c;">Error: ${error.message}</div>`;
    } finally {
        discoverButton.classList.remove('loading');
        discoverButton.disabled = false;
    }
}

function renderPrinterList(printers) {
    const printerList = document.getElementById('printer-list');
    const printerTemplate = document.getElementById('printer-item-template');
    
    if (printers.length === 0) {
        printerList.innerHTML = '<div class="printer-loading">No printers found. Make sure your printer is connected and powered on.</div>';
        return;
    }
    
    printerList.innerHTML = '';
    
    printers.forEach(printer => {
        const printerElement = printerTemplate.content.cloneNode(true);
        
        // Set printer data
        const printerItem = printerElement.querySelector('.printer-item');
        printerItem.setAttribute('data-printer-id', printer.id);
        
        printerElement.querySelector('.printer-name').textContent = printer.name;
        printerElement.querySelector('.printer-type').textContent = printer.type || 'USB';
        printerElement.querySelector('.printer-platform').textContent = printer.platform || 'Unknown';
        
        // Set status indicator
        const statusDot = printerElement.querySelector('.status-dot');
        const statusLabel = printerElement.querySelector('.status-label');
        
        if (printer.isConnected) {
            statusDot.classList.add('connected');
            statusLabel.textContent = printer.status || 'Ready';
        } else {
            statusDot.classList.add('disconnected');
            statusLabel.textContent = 'Offline';
        }
        
        // Set up action buttons
        const connectButton = printerElement.querySelector('.printer-connect');
        const testButton = printerElement.querySelector('.printer-test');
        
        connectButton.addEventListener('click', () => connectToPrinter(printer.id));
        testButton.addEventListener('click', () => testSpecificPrinter(printer.id));
        
        // Disable connect button if printer is offline
        if (!printer.isConnected) {
            connectButton.disabled = true;
            connectButton.textContent = 'Offline';
        }
        
        printerList.appendChild(printerElement);
    });
}

async function connectToPrinter(printerId) {
    try {
        const response = await fetch(`/api/printers/${printerId}/connect`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Save selected printer to localStorage
            localStorage.setItem('selectedPrinter', JSON.stringify({
                id: printerId,
                connectedAt: Date.now()
            }));
            
            showToastNotification(`Connected to printer: ${printerId}`, 'completed');
            
            // Update main printer status
            updateConnectionStatus(true);
            elements.statusText.textContent = `Connected to ${printerId}`;
            
            // Refresh printer list to show updated status
            discoverPrinters();
            
            // Switch to status tab to show connection details
            const statusTab = document.querySelector('[data-tab="status"]');
            if (statusTab) {
                statusTab.click();
            }
        } else {
            throw new Error(data.message || 'Failed to connect to printer');
        }
        
    } catch (error) {
        console.error('Printer connection error:', error);
        showToastNotification(`Failed to connect: ${error.message}`, 'failed');
    }
}

async function testSpecificPrinter(printerId) {
    try {
        // First connect to the printer
        await connectToPrinter(printerId);
        
        // Then test connectivity
        await testPrinterConnectivity();
        
    } catch (error) {
        console.error('Printer test error:', error);
        showToastNotification(`Test failed: ${error.message}`, 'failed');
    }
}

async function loadPrinterStatus() {
    const statusDisplay = document.getElementById('detailed-status');
    
    try {
        statusDisplay.innerHTML = '<div class="status-loading">Loading printer status...</div>';
        
        const response = await fetch('/api/printers/status');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            renderPrinterStatus(data.status);
        } else {
            throw new Error(data.message || 'Failed to get printer status');
        }
        
    } catch (error) {
        console.error('Printer status error:', error);
        statusDisplay.innerHTML = `<div class="status-loading" style="color: #e74c3c;">Error: ${error.message}</div>`;
    }
}

function renderPrinterStatus(status) {
    const statusDisplay = document.getElementById('detailed-status');
    
    const statusItems = [
        { label: 'Connection Status', value: status.isConnected ? 'Connected' : 'Disconnected', class: status.isConnected ? 'connected' : 'disconnected' },
        { label: 'Printer Name', value: status.printerName || status.printerId || 'None selected' },
        { label: 'Printer Status', value: status.status || 'Unknown' },
        { label: 'Last Updated', value: new Date().toLocaleString() }
    ];
    
    if (status.error) {
        statusItems.push({ label: 'Error', value: status.error, class: 'disconnected' });
    }
    
    const statusHTML = statusItems.map(item => `
        <div class="status-item">
            <span class="status-label">${item.label}:</span>
            <span class="status-value ${item.class || ''}">${item.value}</span>
        </div>
    `).join('');
    
    statusDisplay.innerHTML = statusHTML;
}

async function testPrinterConnectivity() {
    const testButton = document.getElementById('test-connectivity');
    
    try {
        testButton.classList.add('loading');
        testButton.disabled = true;
        
        const response = await fetch('/api/printers/test', {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            showToastNotification('Printer connectivity test passed', 'completed');
            
            // Show test results
            const testResult = data.testResult;
            const resultHTML = `
                <div class="status-item">
                    <span class="status-label">Test Result:</span>
                    <span class="status-value connected">PASSED</span>
                </div>
                <div class="status-item">
                    <span class="status-label">Connectivity:</span>
                    <span class="status-value ${testResult.connectivity ? 'connected' : 'disconnected'}">
                        ${testResult.connectivity ? 'OK' : 'FAILED'}
                    </span>
                </div>
                <div class="status-item">
                    <span class="status-label">Printer:</span>
                    <span class="status-value">${testResult.printerName}</span>
                </div>
                <div class="status-item">
                    <span class="status-label">Status:</span>
                    <span class="status-value">${testResult.status}</span>
                </div>
                <div class="status-item">
                    <span class="status-label">Test Time:</span>
                    <span class="status-value">${new Date(testResult.timestamp).toLocaleString()}</span>
                </div>
            `;
            
            document.getElementById('detailed-status').innerHTML = resultHTML;
            
        } else {
            throw new Error(data.message || 'Connectivity test failed');
        }
        
    } catch (error) {
        console.error('Connectivity test error:', error);
        showToastNotification(`Connectivity test failed: ${error.message}`, 'failed');
        
        // Show failure in status display
        const failureHTML = `
            <div class="status-item">
                <span class="status-label">Test Result:</span>
                <span class="status-value disconnected">FAILED</span>
            </div>
            <div class="status-item">
                <span class="status-label">Error:</span>
                <span class="status-value disconnected">${error.message}</span>
            </div>
        `;
        
        document.getElementById('detailed-status').innerHTML = failureHTML;
        
    } finally {
        testButton.classList.remove('loading');
        testButton.disabled = false;
    }
}

async function disconnectPrinter() {
    const disconnectButton = document.getElementById('disconnect-printer');
    
    try {
        disconnectButton.disabled = true;
        
        const response = await fetch('/api/printers/disconnect', {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Clear saved printer from localStorage
            localStorage.removeItem('selectedPrinter');
            
            showToastNotification('Printer disconnected', 'info');
            
            // Update main printer status
            updateConnectionStatus(false);
            elements.statusText.textContent = 'No printer connected';
            
            // Refresh status display
            loadPrinterStatus();
            
        } else {
            throw new Error(data.message || 'Failed to disconnect printer');
        }
        
    } catch (error) {
        console.error('Disconnect error:', error);
        showToastNotification(`Disconnect failed: ${error.message}`, 'failed');
    } finally {
        disconnectButton.disabled = false;
    }
}

async function loadPrinterPresets() {
    const presetsList = document.getElementById('presets-list');
    
    try {
        presetsList.innerHTML = '<div class="presets-loading">Loading printer presets...</div>';
        
        const response = await fetch('/api/printers/presets');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            renderPresetsList(data.presets);
        } else {
            throw new Error(data.message || 'Failed to load presets');
        }
        
    } catch (error) {
        console.error('Presets loading error:', error);
        presetsList.innerHTML = `<div class="presets-loading" style="color: #e74c3c;">Error: ${error.message}</div>`;
    }
}

function renderPresetsList(presets) {
    const presetsList = document.getElementById('presets-list');
    const presetTemplate = document.getElementById('preset-item-template');
    
    if (presets.length === 0) {
        presetsList.innerHTML = '<div class="presets-loading">No presets available</div>';
        return;
    }
    
    presetsList.innerHTML = '';
    
    presets.forEach(preset => {
        const presetElement = presetTemplate.content.cloneNode(true);
        
        presetElement.querySelector('.preset-name').textContent = preset.name;
        presetElement.querySelector('.preset-description').textContent = preset.description;
        
        // Format preset options
        const options = preset.options || {};
        const optionsText = Object.entries(options)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ');
        presetElement.querySelector('.preset-options').textContent = optionsText;
        
        // Set up select button
        const selectButton = presetElement.querySelector('.preset-select');
        selectButton.addEventListener('click', () => selectPreset(preset.name));
        
        presetsList.appendChild(presetElement);
    });
}

function selectPreset(presetName) {
    // For now, just show a notification
    // In a full implementation, this would apply the preset to the current printer
    showToastNotification(`Selected preset: ${presetName}`, 'info');
    
    // You could also store the selected preset in application state
    // and use it for future print jobs
    console.log('Selected preset:', presetName);
}

// Update text positions in database
async function updateTextPositions() {
    console.log('updateTextPositions called');
    try {
        const badgeNameX1El = document.getElementById('badge-name-x1');
        const badgeNameY1El = document.getElementById('badge-name-y1');
        const badgeNameX2El = document.getElementById('badge-name-x2');
        const badgeNameY2El = document.getElementById('badge-name-y2');
        const uidX1El = document.getElementById('uid-x1');
        const uidY1El = document.getElementById('uid-y1');
        const uidX2El = document.getElementById('uid-x2');
        const uidY2El = document.getElementById('uid-y2');
        
        if (!badgeNameX1El || !badgeNameY1El || !badgeNameX2El || !badgeNameY2El || 
            !uidX1El || !uidY1El || !uidX2El || !uidY2El) {
            console.error('Missing input elements');
            showToastNotification('Missing input fields', 'failed');
            return;
        }
        
        const badgeNameX1 = parseInt(badgeNameX1El.value);
        const badgeNameY1 = parseInt(badgeNameY1El.value);
        const badgeNameX2 = parseInt(badgeNameX2El.value);
        const badgeNameY2 = parseInt(badgeNameY2El.value);
        const uidX1 = parseInt(uidX1El.value);
        const uidY1 = parseInt(uidY1El.value);
        const uidX2 = parseInt(uidX2El.value);
        const uidY2 = parseInt(uidY2El.value);
        
        console.log('Updating bounding boxes:', { badgeNameX1, badgeNameY1, badgeNameX2, badgeNameY2, uidX1, uidY1, uidX2, uidY2 });
        
        const textFields = [
            {
                name: 'badgeName',
                x1: badgeNameX1,
                y1: badgeNameY1,
                x2: badgeNameX2,
                y2: badgeNameY2,
                fontFamily: 'Hiragino Kaku Gothic Pro'
            },
            {
                name: 'uid',
                x1: uidX1,
                y1: uidY1,
                x2: uidX2,
                y2: uidY2,
                fontFamily: 'Hiragino Kaku Gothic Pro'
            }
        ];
        
        console.log('Sending textFields:', textFields);
        
        const response = await fetch('/api/templates/badges-template/text-fields', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ textFields })
        });
        
        console.log('Response status:', response.status);
        
        if (response.ok) {
            const result = await response.json();
            console.log('Update result:', result);
            showToastNotification('Text positions updated successfully', 'completed');
            // Force refresh template previews by adding timestamp to bypass cache
            const timestamp = Date.now();
            const templateImages = document.querySelectorAll('.template-image');
            templateImages.forEach(image => {
                const templateId = image.closest('.template-item').querySelector('.template-radio').value;
                const imageParam = appState.selectedImage ? `?badgeImage=${appState.selectedImage}&t=${timestamp}` : `?t=${timestamp}`;
                image.src = `/api/templates/${templateId}/preview${imageParam}`;
            });
            
            // Also refresh live preview if it exists
            const livePreview = document.getElementById('live-preview-image');
            if (livePreview && livePreview.src) {
                generateLiveBadgePreview();
            }
        } else {
            const errorData = await response.json();
            console.error('Update failed:', errorData);
            throw new Error(errorData.message || 'Failed to update positions');
        }
        
    } catch (error) {
        console.error('Error updating positions:', error);
        showToastNotification(`Failed to update positions: ${error.message}`, 'failed');
    }
}

// Load current text positions from database
async function loadCurrentTextPositions() {
    try {
        const response = await fetch('/api/templates/badges-template');
        if (response.ok) {
            const data = await response.json();
            const template = data.template;
            
            let textFields = [];
            try {
                textFields = typeof template.textFields === 'string' 
                    ? JSON.parse(template.textFields) 
                    : template.textFields || [];
            } catch (e) {
                textFields = [];
            }
            
            const badgeNameField = textFields.find(field => field.name === 'badgeName');
            const uidField = textFields.find(field => field.name === 'uid');
            
            if (badgeNameField) {
                document.getElementById('badge-name-x1').value = badgeNameField.x1 || 100;
                document.getElementById('badge-name-y1').value = badgeNameField.y1 || 250;
                document.getElementById('badge-name-x2').value = badgeNameField.x2 || 500;
                document.getElementById('badge-name-y2').value = badgeNameField.y2 || 350;
            }
            
            if (uidField) {
                document.getElementById('uid-x1').value = uidField.x1 || 100;
                document.getElementById('uid-y1').value = uidField.y1 || 650;
                document.getElementById('uid-x2').value = uidField.x2 || 300;
                document.getElementById('uid-y2').value = uidField.y2 || 720;
            }
            
            // Update visual editor
            if (visualEditor.canvas) {
                loadEditorPositions();
                drawEditor();
            }
        }
    } catch (error) {
        console.error('Failed to load text positions:', error);
    }
}

// Visual editor state
let visualEditor = {
    canvas: null,
    ctx: null,
    selectedElement: null,
    isDragging: false,
    dragOffset: { x: 0, y: 0 },
    elements: {
        badgeName: { x: 50, y: 150, width: 200, height: 40, fontSize: 28, visible: true },
        uid: { x: 50, y: 350, width: 150, height: 20, fontSize: 14, visible: true }
    }
};

// Initialize visual editor
function initializeVisualEditor() {
    setTimeout(() => {
        const canvas = document.getElementById('position-editor');
        if (!canvas) {
            console.log('Canvas not found');
            return;
        }
        
        visualEditor.canvas = canvas;
        visualEditor.ctx = canvas.getContext('2d');
        
        // Set default bounding boxes
        visualEditor.elements = {
            badgeName: { x1: 50, y1: 125, x2: 250, y2: 175, visible: true },
            uid: { x1: 50, y1: 325, x2: 150, y2: 360, visible: true }
        };
        
        // Event listeners
        canvas.addEventListener('mousedown', handleEditorMouseDown);
        canvas.addEventListener('mousemove', handleEditorMouseMove);
        canvas.addEventListener('mouseup', handleEditorMouseUp);
        
        // Load badge image if selected
        loadBadgeImageForEditor();
        
        // Load current positions from database
        loadEditorPositions();
        
        console.log('Visual editor initialized');
    }, 200);
}

// Load current positions into editor from database
async function loadEditorPositions() {
    try {
        const response = await fetch('/api/templates/badges-template');
        if (response.ok) {
            const data = await response.json();
            const template = data.template;
            
            let textFields = [];
            try {
                textFields = typeof template.textFields === 'string' 
                    ? JSON.parse(template.textFields) 
                    : template.textFields || [];
            } catch (e) {
                textFields = [];
            }
            
            const badgeNameField = textFields.find(field => field.name === 'badgeName');
            const uidField = textFields.find(field => field.name === 'uid');
            
            const scale = 613 / 1226;
            
            // Handle both old format (x,y,fontSize) and new format (x1,y1,x2,y2)
            let badgeNameX1, badgeNameY1, badgeNameX2, badgeNameY2;
            let uidX1, uidY1, uidX2, uidY2;
            
            if (badgeNameField) {
                if (badgeNameField.x1 !== undefined) {
                    // New bounding box format
                    badgeNameX1 = badgeNameField.x1;
                    badgeNameY1 = badgeNameField.y1;
                    badgeNameX2 = badgeNameField.x2;
                    badgeNameY2 = badgeNameField.y2;
                } else {
                    // Old format - convert to bounding box
                    badgeNameX1 = badgeNameField.x || 100;
                    badgeNameY1 = badgeNameField.y || 250;
                    badgeNameX2 = badgeNameX1 + 400;
                    badgeNameY2 = badgeNameY1 + 100;
                }
            } else {
                // Defaults
                badgeNameX1 = 100;
                badgeNameY1 = 250;
                badgeNameX2 = 500;
                badgeNameY2 = 350;
            }
            
            if (uidField) {
                if (uidField.x1 !== undefined) {
                    // New bounding box format
                    uidX1 = uidField.x1;
                    uidY1 = uidField.y1;
                    uidX2 = uidField.x2;
                    uidY2 = uidField.y2;
                } else {
                    // Old format - convert to bounding box
                    uidX1 = uidField.x || 100;
                    uidY1 = uidField.y || 650;
                    uidX2 = uidX1 + 200;
                    uidY2 = uidY1 + 70;
                }
            } else {
                // Defaults
                uidX1 = 100;
                uidY1 = 650;
                uidX2 = 300;
                uidY2 = 720;
            }
            
            visualEditor.elements.badgeName = {
                x1: badgeNameX1 * scale,
                y1: badgeNameY1 * scale,
                x2: badgeNameX2 * scale,
                y2: badgeNameY2 * scale,
                visible: true
            };
            
            visualEditor.elements.uid = {
                x1: uidX1 * scale,
                y1: uidY1 * scale,
                x2: uidX2 * scale,
                y2: uidY2 * scale,
                visible: true
            };
            
            console.log('Loaded positions from database:', { badgeNameX1, badgeNameY1, badgeNameX2, badgeNameY2, uidX1, uidY1, uidX2, uidY2 });
            drawEditor();
        }
    } catch (error) {
        console.error('Failed to load editor positions:', error);
    }
}

// Draw the editor canvas
function drawEditor() {
    if (!visualEditor.ctx || !visualEditor.canvas) return;
    
    const ctx = visualEditor.ctx;
    const canvas = visualEditor.canvas;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw badge background if available
    if (visualEditor.badgeImage) {
        ctx.drawImage(visualEditor.badgeImage, 0, 0, canvas.width, canvas.height);
    } else {
        // Draw default background
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#dee2e6';
        ctx.strokeRect(0, 0, canvas.width, canvas.height);
    }
    
    // Draw badge name bounding box
    const badgeName = visualEditor.elements.badgeName;
    const badgeNameWidth = badgeName.x2 - badgeName.x1;
    const badgeNameHeight = badgeName.y2 - badgeName.y1;
    
    ctx.fillStyle = 'rgba(52, 152, 219, 0.2)';
    ctx.fillRect(badgeName.x1, badgeName.y1, badgeNameWidth, badgeNameHeight);
    ctx.strokeStyle = '#3498db';
    ctx.strokeRect(badgeName.x1, badgeName.y1, badgeNameWidth, badgeNameHeight);
    
    // Auto-scale text for badge name
    const badgeNameText = 'Badge Name';
    let badgeNameFontSize = Math.min(badgeNameHeight * 0.6, badgeNameWidth / badgeNameText.length * 1.2);
    ctx.fillStyle = '#2c3e50';
    ctx.font = `${badgeNameFontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeNameText, badgeName.x1 + badgeNameWidth/2, badgeName.y1 + badgeNameHeight/2);
    
    // Draw UID bounding box
    const uid = visualEditor.elements.uid;
    const uidWidth = uid.x2 - uid.x1;
    const uidHeight = uid.y2 - uid.y1;
    
    ctx.fillStyle = 'rgba(231, 76, 60, 0.2)';
    ctx.fillRect(uid.x1, uid.y1, uidWidth, uidHeight);
    ctx.strokeStyle = '#e74c3c';
    ctx.strokeRect(uid.x1, uid.y1, uidWidth, uidHeight);
    
    // Auto-scale text for UID
    const uidText = 'UID123';
    let uidFontSize = Math.min(uidHeight * 0.6, uidWidth / uidText.length * 1.2);
    ctx.fillStyle = '#2c3e50';
    ctx.font = `${uidFontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(uidText, uid.x1 + uidWidth/2, uid.y1 + uidHeight/2);
}

// Handle mouse events
function handleEditorMouseDown(e) {
    const rect = visualEditor.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    visualEditor.isResizing = false;
    visualEditor.isDragging = false;
    
    // Check which element was clicked
    Object.entries(visualEditor.elements).forEach(([key, element]) => {
        if (!element.visible) return;
        
        const resizeZone = 10; // pixels from edge for resize
        
        // Check if clicking on resize areas (edges/corners)
        const onLeftEdge = x >= element.x1 - resizeZone && x <= element.x1 + resizeZone;
        const onRightEdge = x >= element.x2 - resizeZone && x <= element.x2 + resizeZone;
        const onTopEdge = y >= element.y1 - resizeZone && y <= element.y1 + resizeZone;
        const onBottomEdge = y >= element.y2 - resizeZone && y <= element.y2 + resizeZone;
        
        const inBounds = x >= element.x1 - resizeZone && x <= element.x2 + resizeZone &&
                        y >= element.y1 - resizeZone && y <= element.y2 + resizeZone;
        
        if (inBounds) {
            visualEditor.selectedElement = key;
            
            if (onLeftEdge || onRightEdge || onTopEdge || onBottomEdge) {
                // Resize mode
                visualEditor.isResizing = true;
                visualEditor.resizeMode = {
                    left: onLeftEdge,
                    right: onRightEdge,
                    top: onTopEdge,
                    bottom: onBottomEdge
                };
            } else {
                // Drag mode
                visualEditor.isDragging = true;
                visualEditor.dragOffset = {
                    x: x - element.x1,
                    y: y - element.y1
                };
            }
        }
    });
    
    drawEditor();
}

function handleEditorMouseMove(e) {
    if ((!visualEditor.isDragging && !visualEditor.isResizing) || !visualEditor.selectedElement) return;
    
    const rect = visualEditor.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const element = visualEditor.elements[visualEditor.selectedElement];
    
    if (visualEditor.isDragging) {
        // Drag mode - move the entire box
        const width = element.x2 - element.x1;
        const height = element.y2 - element.y1;
        
        const newX1 = Math.max(0, Math.min(x - visualEditor.dragOffset.x, visualEditor.canvas.width - width));
        const newY1 = Math.max(0, Math.min(y - visualEditor.dragOffset.y, visualEditor.canvas.height - height));
        
        element.x1 = newX1;
        element.y1 = newY1;
        element.x2 = newX1 + width;
        element.y2 = newY1 + height;
        
    } else if (visualEditor.isResizing) {
        // Resize mode - adjust edges
        const minSize = 20; // Minimum box size
        
        if (visualEditor.resizeMode.left) {
            element.x1 = Math.max(0, Math.min(x, element.x2 - minSize));
        }
        if (visualEditor.resizeMode.right) {
            element.x2 = Math.max(element.x1 + minSize, Math.min(x, visualEditor.canvas.width));
        }
        if (visualEditor.resizeMode.top) {
            element.y1 = Math.max(0, Math.min(y, element.y2 - minSize));
        }
        if (visualEditor.resizeMode.bottom) {
            element.y2 = Math.max(element.y1 + minSize, Math.min(y, visualEditor.canvas.height));
        }
    }
    
    drawEditor();
}

function handleEditorMouseUp(e) {
    if (visualEditor.isDragging || visualEditor.isResizing) {
        updateInputsFromEditor();
    }
    visualEditor.isDragging = false;
    visualEditor.isResizing = false;
    visualEditor.resizeMode = null;
}



// Update input fields from editor positions
function updateInputsFromEditor() {
    const scale = 1226 / 613; // Convert back to full size
    
    const badgeName = visualEditor.elements.badgeName;
    const uid = visualEditor.elements.uid;
    
    const badgeNameX1Input = document.getElementById('badge-name-x1');
    const badgeNameY1Input = document.getElementById('badge-name-y1');
    const badgeNameX2Input = document.getElementById('badge-name-x2');
    const badgeNameY2Input = document.getElementById('badge-name-y2');
    const uidX1Input = document.getElementById('uid-x1');
    const uidY1Input = document.getElementById('uid-y1');
    const uidX2Input = document.getElementById('uid-x2');
    const uidY2Input = document.getElementById('uid-y2');
    
    if (badgeNameX1Input) badgeNameX1Input.value = Math.round(badgeName.x1 * scale);
    if (badgeNameY1Input) badgeNameY1Input.value = Math.round(badgeName.y1 * scale);
    if (badgeNameX2Input) badgeNameX2Input.value = Math.round(badgeName.x2 * scale);
    if (badgeNameY2Input) badgeNameY2Input.value = Math.round(badgeName.y2 * scale);
    if (uidX1Input) uidX1Input.value = Math.round(uid.x1 * scale);
    if (uidY1Input) uidY1Input.value = Math.round(uid.y1 * scale);
    if (uidX2Input) uidX2Input.value = Math.round(uid.x2 * scale);
    if (uidY2Input) uidY2Input.value = Math.round(uid.y2 * scale);
    
    console.log('Updated inputs:', {
        badgeNameX1: Math.round(badgeName.x1 * scale),
        badgeNameY1: Math.round(badgeName.y1 * scale),
        badgeNameX2: Math.round(badgeName.x2 * scale),
        badgeNameY2: Math.round(badgeName.y2 * scale),
        uidX1: Math.round(uid.x1 * scale),
        uidY1: Math.round(uid.y1 * scale),
        uidX2: Math.round(uid.x2 * scale),
        uidY2: Math.round(uid.y2 * scale)
    });
}

// Load badge image for visual editor
function loadBadgeImageForEditor() {
    if (!appState.selectedImage) return;
    
    const img = new Image();
    img.onload = function() {
        visualEditor.badgeImage = img;
        drawEditor();
    };
    img.src = `/images/badges/${appState.selectedImage}`;
}

// Reset text positions to default
function resetTextPositions() {
    document.getElementById('badge-name-x1').value = 100;
    document.getElementById('badge-name-y1').value = 250;
    document.getElementById('badge-name-x2').value = 500;
    document.getElementById('badge-name-y2').value = 350;
    document.getElementById('uid-x1').value = 100;
    document.getElementById('uid-y1').value = 650;
    document.getElementById('uid-x2').value = 300;
    document.getElementById('uid-y2').value = 720;
    
    loadEditorPositions();
    drawEditor();
}

// System Monitor functionality
const SystemMonitor = {
    isOpen: false,
    currentTab: 'health',
    refreshIntervals: {},

    init() {
        this.bindEvents();
        this.setupTabs();
    },

    bindEvents() {
        // System monitor button
        const systemMonitorBtn = document.getElementById('system-monitor-btn');
        if (systemMonitorBtn) {
            systemMonitorBtn.addEventListener('click', () => this.open());
        }

        // Modal close events
        const closeBtn = document.getElementById('system-monitor-close');
        const overlay = document.getElementById('system-monitor-overlay');
        
        if (closeBtn) closeBtn.addEventListener('click', () => this.close());
        if (overlay) overlay.addEventListener('click', () => this.close());

        // Tab buttons
        document.querySelectorAll('.monitor-tabs .tab-button').forEach(button => {
            button.addEventListener('click', (e) => {
                const tab = e.target.dataset.tab;
                this.switchTab(tab);
            });
        });

        // Refresh buttons
        this.bindRefreshButtons();
    },

    bindRefreshButtons() {
        const refreshButtons = {
            'refresh-health': () => this.loadHealth(),
            'detailed-health': () => this.loadHealth(true),
            'refresh-errors': () => this.loadErrors(),
            'refresh-logs': () => this.loadLogs(),
            'refresh-alerts': () => this.loadAlerts(),
            'run-full-diagnostics': () => this.runDiagnostics('full'),
            'run-quick-diagnostics': () => this.runDiagnostics('quick')
        };

        Object.entries(refreshButtons).forEach(([id, handler]) => {
            const button = document.getElementById(id);
            if (button) {
                button.addEventListener('click', handler);
            }
        });

        // Dropdown change handlers
        const errorTimeRange = document.getElementById('error-time-range');
        if (errorTimeRange) {
            errorTimeRange.addEventListener('change', () => this.loadErrors());
        }

        const logCategory = document.getElementById('log-category');
        const logLines = document.getElementById('log-lines');
        if (logCategory) logCategory.addEventListener('change', () => this.loadLogs());
        if (logLines) logLines.addEventListener('change', () => this.loadLogs());
    },

    setupTabs() {
        // Initialize tab functionality
        const tabButtons = document.querySelectorAll('.monitor-tabs .tab-button');
        const tabPanels = document.querySelectorAll('.tab-panel');

        tabButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const targetTab = e.target.dataset.tab;
                
                // Update active states
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabPanels.forEach(panel => panel.classList.remove('active'));
                
                e.target.classList.add('active');
                document.getElementById(`${targetTab}-panel`).classList.add('active');
                
                this.currentTab = targetTab;
                this.loadTabContent(targetTab);
            });
        });
    },

    open() {
        const modal = document.getElementById('system-monitor-modal');
        if (modal) {
            modal.style.display = 'block';
            modal.setAttribute('aria-hidden', 'false');
            this.isOpen = true;
            
            // Load initial content
            this.loadTabContent(this.currentTab);
            
            // Set up auto-refresh for certain tabs
            this.startAutoRefresh();
        }
    },

    close() {
        const modal = document.getElementById('system-monitor-modal');
        if (modal) {
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
            this.isOpen = false;
            
            // Clear auto-refresh intervals
            this.stopAutoRefresh();
        }
    },

    switchTab(tab) {
        this.currentTab = tab;
        this.loadTabContent(tab);
    },

    loadTabContent(tab) {
        switch (tab) {
            case 'health':
                this.loadHealth();
                break;
            case 'errors':
                this.loadErrors();
                break;
            case 'logs':
                this.loadLogs();
                break;
            case 'diagnostics':
                this.loadDiagnosticHistory();
                break;
            case 'alerts':
                this.loadAlerts();
                break;
        }
    },

    async loadHealth(detailed = false) {
        const container = document.getElementById('health-overview');
        if (!container) return;

        container.innerHTML = '<div class="health-loading">Loading system health...</div>';

        try {
            const url = detailed ? '/api/monitoring/health?detailed=true' : '/api/monitoring/health';
            const response = await fetch(url);
            const data = await response.json();

            this.renderHealthStatus(container, data);
        } catch (error) {
            container.innerHTML = `<div class="error">Failed to load health status: ${error.message}</div>`;
        }
    },

    renderHealthStatus(container, data) {
        const statusClass = data.status === 'healthy' ? 'healthy' : 
                           data.status === 'degraded' ? 'warning' : 'error';

        let html = `
            <div class="health-card ${statusClass}">
                <h4>Overall Status</h4>
                <div class="status ${statusClass}">${data.status}</div>
                <div class="details">
                    Uptime: ${Math.floor(data.uptime / 60)} minutes<br>
                    Environment: ${data.environment}
                </div>
            </div>
        `;

        if (data.diagnostics) {
            // Add detailed diagnostic cards
            Object.entries(data.diagnostics).forEach(([component, result]) => {
                const componentStatus = result.errors && result.errors.length > 0 ? 'error' : 'healthy';
                html += `
                    <div class="health-card ${componentStatus}">
                        <h4>${component.charAt(0).toUpperCase() + component.slice(1)}</h4>
                        <div class="status ${componentStatus}">
                            ${componentStatus === 'healthy' ? 'OK' : 'Issues'}
                        </div>
                        <div class="details">
                            ${result.errors ? result.errors.slice(0, 2).join('<br>') : 'All checks passed'}
                        </div>
                    </div>
                `;
            });
        }

        container.innerHTML = html;
    },

    async loadErrors() {
        const container = document.getElementById('error-summary');
        const recentContainer = document.getElementById('recent-errors .error-list');
        if (!container || !recentContainer) return;

        container.innerHTML = '<div class="error-loading">Loading error summary...</div>';
        recentContainer.innerHTML = '<div class="error-loading">Loading recent errors...</div>';

        try {
            const hours = document.getElementById('error-time-range')?.value || 24;
            const response = await fetch(`/api/monitoring/errors?hours=${hours}`);
            const data = await response.json();

            this.renderErrorSummary(container, data);
            this.renderRecentErrors(recentContainer, data.recentErrors);
        } catch (error) {
            container.innerHTML = `<div class="error">Failed to load errors: ${error.message}</div>`;
            recentContainer.innerHTML = `<div class="error">Failed to load recent errors: ${error.message}</div>`;
        }
    },

    renderErrorSummary(container, data) {
        const html = `
            <div class="error-stat">
                <span class="number">${data.totalErrors}</span>
                <span class="label">Total Errors</span>
            </div>
            <div class="error-stat">
                <span class="number">${data.uniqueErrorTypes}</span>
                <span class="label">Error Types</span>
            </div>
            <div class="error-stat">
                <span class="number">${data.timeRange.hours}h</span>
                <span class="label">Time Range</span>
            </div>
        `;
        container.innerHTML = html;
    },

    renderRecentErrors(container, errors) {
        if (!errors || errors.length === 0) {
            container.innerHTML = '<div class="no-errors">No recent errors found</div>';
            return;
        }

        const html = errors.map(error => `
            <div class="error-item">
                <div class="error-time">${new Date(error.timestamp).toLocaleString()}</div>
                <div class="error-message">${error.message}</div>
                ${error.context ? `<div class="error-context">${JSON.stringify(error.context, null, 2)}</div>` : ''}
            </div>
        `).join('');

        container.innerHTML = html;
    },

    async loadLogs() {
        const container = document.getElementById('log-display');
        if (!container) return;

        container.innerHTML = '<div class="log-loading">Loading logs...</div>';

        try {
            const category = document.getElementById('log-category')?.value || 'combined';
            const lines = document.getElementById('log-lines')?.value || 100;
            
            const response = await fetch(`/api/monitoring/logs/${category}?lines=${lines}`);
            const data = await response.json();

            this.renderLogs(container, data.logs);
        } catch (error) {
            container.innerHTML = `Failed to load logs: ${error.message}`;
        }
    },

    renderLogs(container, logs) {
        if (!logs || logs.length === 0) {
            container.innerHTML = 'No logs found';
            return;
        }

        const html = logs.map(log => `
            <div class="log-entry">
                <span class="log-timestamp">${log.timestamp}</span>
                <span class="log-level ${log.level}">[${log.level}]</span>
                <span class="log-message">${log.message}</span>
            </div>
        `).join('');

        container.innerHTML = html;
        container.scrollTop = container.scrollHeight;
    },

    async loadAlerts() {
        const container = document.getElementById('alert-display');
        if (!container) return;

        container.innerHTML = '<div class="alert-loading">Loading system alerts...</div>';

        try {
            const response = await fetch('/api/monitoring/alerts');
            const data = await response.json();

            this.renderAlerts(container, data.alerts);
        } catch (error) {
            container.innerHTML = `<div class="error">Failed to load alerts: ${error.message}</div>`;
        }
    },

    renderAlerts(container, alerts) {
        if (!alerts || alerts.length === 0) {
            container.innerHTML = '<div class="no-alerts">No active alerts</div>';
            return;
        }

        const html = alerts.map(alert => `
            <div class="alert-item ${alert.type}">
                <div class="alert-header">
                    <span class="alert-type">${alert.type}</span>
                    <span class="alert-time">${new Date(alert.timestamp).toLocaleString()}</span>
                </div>
                <div class="alert-message">${alert.message}</div>
                <div class="alert-details">
                    Category: ${alert.category} | 
                    Value: ${alert.value}
                    ${alert.threshold ? ` | Threshold: ${alert.threshold}` : ''}
                </div>
            </div>
        `).join('');

        container.innerHTML = html;
    },

    async runDiagnostics(type) {
        const container = document.getElementById('diagnostic-results');
        if (!container) return;

        const button = document.getElementById(type === 'full' ? 'run-full-diagnostics' : 'run-quick-diagnostics');
        if (button) {
            button.disabled = true;
            button.innerHTML = '<span class="loading-spinner"></span> Running...';
        }

        container.innerHTML = '<div class="diagnostic-loading">Running diagnostics...</div>';

        try {
            let response;
            if (type === 'full') {
                response = await fetch('/api/diagnostics');
            } else {
                // Run quick diagnostics (just a few components)
                const components = ['system', 'database', 'services'];
                const results = await Promise.all(
                    components.map(comp => 
                        fetch('/api/monitoring/diagnostics/run', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ component: comp })
                        }).then(r => r.json())
                    )
                );
                response = { ok: true };
                response.json = () => Promise.resolve({ results });
            }

            const data = await response.json();
            this.renderDiagnosticResults(container, data);
        } catch (error) {
            container.innerHTML = `<div class="error">Failed to run diagnostics: ${error.message}</div>`;
        } finally {
            if (button) {
                button.disabled = false;
                button.innerHTML = type === 'full' ? 'Run Full Diagnostics' : 'Quick Check';
            }
        }
    },

    renderDiagnosticResults(container, data) {
        let html = '';

        if (data.results) {
            // Quick diagnostics results
            data.results.forEach(result => {
                const status = result.result.errors && result.result.errors.length > 0 ? 'error' : 'ok';
                html += `
                    <div class="diagnostic-section">
                        <h4>
                            ${result.component.charAt(0).toUpperCase() + result.component.slice(1)}
                            <span class="diagnostic-status ${status}">${status}</span>
                        </h4>
                        <div class="diagnostic-details">
                            ${result.result.errors && result.result.errors.length > 0 ? 
                                `<ul>${result.result.errors.map(err => `<li>${err}</li>`).join('')}</ul>` :
                                'All checks passed'
                            }
                        </div>
                    </div>
                `;
            });
        } else {
            // Full diagnostics results
            Object.entries(data).forEach(([component, result]) => {
                if (component === 'timestamp') return;
                
                const status = result.errors && result.errors.length > 0 ? 'error' : 'ok';
                html += `
                    <div class="diagnostic-section">
                        <h4>
                            ${component.charAt(0).toUpperCase() + component.slice(1)}
                            <span class="diagnostic-status ${status}">${status}</span>
                        </h4>
                        <div class="diagnostic-details">
                            ${result.errors && result.errors.length > 0 ? 
                                `<ul>${result.errors.map(err => `<li>${err}</li>`).join('')}</ul>` :
                                'All checks passed'
                            }
                        </div>
                    </div>
                `;
            });
        }

        container.innerHTML = html;
    },

    async loadDiagnosticHistory() {
        const container = document.getElementById('diagnostic-history .history-list');
        if (!container) return;

        try {
            const response = await fetch('/api/monitoring/diagnostics/history');
            const data = await response.json();

            this.renderDiagnosticHistory(container, data.history);
        } catch (error) {
            container.innerHTML = `<div class="error">Failed to load diagnostic history: ${error.message}</div>`;
        }
    },

    renderDiagnosticHistory(container, history) {
        if (!history || history.length === 0) {
            container.innerHTML = '<div class="no-history">No diagnostic history available</div>';
            return;
        }

        const html = history.map(item => `
            <div class="history-item">
                <div class="history-info">
                    <div class="history-component">${item.component}</div>
                    <div class="history-time">${new Date(item.timestamp).toLocaleString()}</div>
                </div>
                <div class="history-status ${item.summary.status}">${item.summary.status}</div>
            </div>
        `).join('');

        container.innerHTML = html;
    },

    startAutoRefresh() {
        // Auto-refresh health status every 30 seconds
        if (this.currentTab === 'health') {
            this.refreshIntervals.health = setInterval(() => {
                if (this.isOpen && this.currentTab === 'health') {
                    this.loadHealth();
                }
            }, 30000);
        }

        // Auto-refresh alerts every 60 seconds
        if (this.currentTab === 'alerts') {
            this.refreshIntervals.alerts = setInterval(() => {
                if (this.isOpen && this.currentTab === 'alerts') {
                    this.loadAlerts();
                }
            }, 60000);
        }
    },

    stopAutoRefresh() {
        Object.values(this.refreshIntervals).forEach(interval => {
            clearInterval(interval);
        });
        this.refreshIntervals = {};
    }
};

// Initialize system monitor when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    SystemMonitor.init();
});