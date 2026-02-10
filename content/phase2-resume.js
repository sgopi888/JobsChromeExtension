// Phase 2: Resume Upload and Management
// Handles resume file storage and auto-upload to application pages

console.log('Phase 2: Resume module loaded');

/**
 * Upload stored resume to a file input element
 * @param {HTMLInputElement} fileInput - The file input element
 * @returns {Promise<boolean>} Success status
 */
async function uploadStoredResume(fileInput) {
    try {
        console.log('[Phase2-Resume] Uploading stored resume to file input');
        
        // Get stored resume from chrome.storage
        const result = await chrome.storage.local.get('resumeFile');
        
        if (!result.resumeFile) {
            throw new Error('No resume file stored. Please upload a resume first.');
        }
        
        const resumeFile = result.resumeFile;
        console.log(`[Phase2-Resume] Found stored resume: ${resumeFile.name}`);
        
        // Convert base64 back to Blob
        const response = await fetch(resumeFile.data);
        const blob = await response.blob();
        
        // Create File object
        const file = new File([blob], resumeFile.name, { type: resumeFile.type });
        
        // Create DataTransfer to set files on input
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        
        // Set files on input
        fileInput.files = dataTransfer.files;
        
        // Trigger events to notify the page
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
        
        console.log('[Phase2-Resume] ✓ Resume uploaded successfully');
        return true;
        
    } catch (error) {
        console.error('[Phase2-Resume] Error uploading resume:', error);
        throw error;
    }
}

/**
 * Clear all pre-filled text fields on the page
 * This is called after the website auto-fills from resume
 */
async function clearAllPreFilledFields() {
    try {
        console.log('[Phase2-Resume] Clearing all pre-filled text fields');
        
        const textFields = document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type]), textarea');
        let clearedCount = 0;
        
        for (const field of textFields) {
            // Skip if field is hidden, disabled, or readonly
            if (field.type === 'hidden' || field.disabled || field.readOnly) {
                continue;
            }
            
            // Skip if field is empty
            if (!field.value || field.value.trim() === '') {
                continue;
            }
            
            // Clear the field
            field.value = '';
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
            clearedCount++;
        }
        
        console.log(`[Phase2-Resume] ✓ Cleared ${clearedCount} pre-filled fields`);

        // Refresh field metadata so Phase 1 can find cleared fields
        if (window.FieldMetadataManager) {
            await window.FieldMetadataManager.refreshFieldMetadata();
        }

        return clearedCount;

    } catch (error) {
        console.error('[Phase2-Resume] Error clearing fields:', error);
        throw error;
    }
}

/**
 * Auto-upload resume to application page
 * Finds file input, uploads resume, waits for auto-fill, then clears fields
 */
async function autoUploadResumeToPage() {
    try {
        console.log('[Phase2-Resume] Starting auto-upload process');
        
        // Find file input for resume
        const fileInputs = document.querySelectorAll('input[type="file"]');
        
        if (fileInputs.length === 0) {
            throw new Error('No file input found on page');
        }
        
        // Try to find the resume input specifically
        let resumeInput = null;
        for (const input of fileInputs) {
            const label = getFieldLabel(input);
            if (label.toLowerCase().includes('resume') || 
                label.toLowerCase().includes('cv') ||
                input.name.toLowerCase().includes('resume') ||
                input.name.toLowerCase().includes('cv')) {
                resumeInput = input;
                break;
            }
        }
        
        // If not found, use first file input
        if (!resumeInput) {
            console.log('[Phase2-Resume] No specific resume input found, using first file input');
            resumeInput = fileInputs[0];
        }
        
        console.log('[Phase2-Resume] Found resume input:', resumeInput);
        
        // Upload resume
        await uploadStoredResume(resumeInput);
        
        // Wait for website to auto-fill fields (3 seconds)
        console.log('[Phase2-Resume] Waiting 3 seconds for website to auto-fill...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Clear all pre-filled fields
        const clearedCount = await clearAllPreFilledFields();
        
        // Notify sidepanel
        chrome.runtime.sendMessage({
            action: 'notifySidePanel',
            data: {
                type: 'resume_uploaded',
                clearedFields: clearedCount
            }
        });
        
        console.log('[Phase2-Resume] ✓ Auto-upload process complete');
        return {
            success: true,
            clearedFields: clearedCount
        };
        
    } catch (error) {
        console.error('[Phase2-Resume] Auto-upload failed:', error);
        
        // Notify sidepanel of error
        chrome.runtime.sendMessage({
            action: 'notifySidePanel',
            data: {
                type: 'resume_upload_error',
                error: error.message
            }
        });
        
        throw error;
    }
}

/**
 * Helper function to get field label (reused from content-script.js)
 */
function getFieldLabel(element) {
    // Try label element
    if (element.id) {
        const label = document.querySelector(`label[for="${element.id}"]`);
        if (label) return label.textContent.trim();
    }
    
    // Try parent label
    const parentLabel = element.closest('label');
    if (parentLabel) {
        return parentLabel.textContent.replace(element.value, '').trim();
    }
    
    // Try aria-label
    if (element.getAttribute('aria-label')) {
        return element.getAttribute('aria-label');
    }
    
    // Try placeholder
    if (element.placeholder) {
        return element.placeholder;
    }
    
    // Try previous sibling text
    let prev = element.previousElementSibling;
    while (prev) {
        if (prev.textContent.trim()) {
            return prev.textContent.trim();
        }
        prev = prev.previousElementSibling;
    }
    
    return element.name || 'Unknown field';
}

// Listen for messages from sidepanel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'autoUploadResume') {
        autoUploadResumeToPage()
            .then(result => sendResponse({ success: true, ...result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep channel open for async response
    }
    // CRITICAL FIX: Pass through unhandled messages to other listeners
    return false;
});

// Export functions for use in other modules
window.Phase2Resume = {
    uploadStoredResume,
    clearAllPreFilledFields,
    autoUploadResumeToPage
};
