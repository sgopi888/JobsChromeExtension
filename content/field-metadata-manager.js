// Field Metadata Manager
// Handles field metadata refresh and synchronization after DOM changes
console.log('Field Metadata Manager loaded');

/**
 * Refresh field metadata after DOM changes
 * This ensures findElement() can still locate fields after clearing
 */
async function refreshFieldMetadata() {
    console.log('[FieldManager] Refreshing field metadata...');

    // Re-scan all form fields
    const formElements = document.querySelectorAll('input, select, textarea');
    const metadata = {};
    let scannedCount = 0;

    for (const element of formElements) {
        // Skip hidden, disabled, or readonly fields
        if (element.type === 'hidden' || element.disabled || element.readOnly) {
            continue;
        }

        // Generate field ID (use existing or create new one)
        const fieldId = element.getAttribute('data-field-id') || element.id || element.name;

        if (fieldId) {
            metadata[fieldId] = {
                originalId: element.id || null,
                name: element.name || '',
                selector: generateSelector(element),
                type: element.type || element.tagName.toLowerCase(),
                element: element // Store reference for quick lookup
            };
            scannedCount++;
        }
    }

    // Update window.fieldMetadata (merge with existing if present)
    if (!window.fieldMetadata) {
        window.fieldMetadata = {};
    }

    // Merge new metadata with existing
    window.fieldMetadata = { ...window.fieldMetadata, ...metadata };

    console.log(`[FieldManager] ✓ Refreshed metadata for ${scannedCount} fields (total: ${Object.keys(window.fieldMetadata).length})`);

    return metadata;
}

/**
 * Generate CSS selector for element
 * Reused logic from content-script.js
 */
function generateSelector(element) {
    // Prefer ID selector
    if (element.id) {
        return `#${element.id}`;
    }

    // Try name attribute
    if (element.name) {
        return `[name="${element.name}"]`;
    }

    // Build selector from tag + attributes
    let selector = element.tagName.toLowerCase();

    // Add type if present
    if (element.type) {
        selector += `[type="${element.type}"]`;
    }

    // Add placeholder if present
    if (element.placeholder) {
        selector += `[placeholder="${element.placeholder}"]`;
    }

    // Add class if present (first class only)
    if (element.className && typeof element.className === 'string') {
        const firstClass = element.className.split(' ')[0];
        if (firstClass) {
            selector += `.${firstClass}`;
        }
    }

    return selector;
}

/**
 * Clear all metadata (useful for reset)
 */
function clearFieldMetadata() {
    console.log('[FieldManager] Clearing all field metadata');
    window.fieldMetadata = {};
}

/**
 * Get metadata for specific field
 */
function getFieldMetadata(fieldId) {
    return window.fieldMetadata?.[fieldId] || null;
}

// Export to global scope
window.FieldMetadataManager = {
    refreshFieldMetadata,
    clearFieldMetadata,
    getFieldMetadata
};

console.log('[FieldManager] Functions exported: refreshFieldMetadata, clearFieldMetadata, getFieldMetadata');
