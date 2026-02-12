// FIELD FILLER V2 - Simple, Direct Form Filling
// No fallbacks, no retries, no complex logic - just fill the form correctly ONCE
console.log('[FillerV2] Loading...');

/**
 * SIMPLE FILL ORCHESTRATOR
 * Takes a fill plan item, finds element, fills it ONCE, returns success/failure
 */
async function fillFieldV2(item) {
    console.log(`[FillerV2] Processing: ${item.fieldId} (${item.action})`);

    // Find the element
    const element = findElementV2(item.fieldId, item.action);
    if (!element) {
        console.error(`[FillerV2] ❌ Element not found: ${item.fieldId}`);
        return { success: false, error: 'Element not found' };
    }

    // Scroll into view
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await wait(300);

    // Route to correct filler based on action
    let result = false;
    try {
        switch (item.action.toLowerCase()) {
            case 'select':
                result = await fillSelectV2(element, item);
                break;
            case 'check':
            case 'radio':
                result = await fillCheckboxRadioV2(element, item);
                break;
            case 'multiselect':
                result = await fillMultiSelectV2(element, item);
                break;
            default:
                console.warn(`[FillerV2] Unknown action: ${item.action}`);
                return { success: false, error: 'Unknown action' };
        }

        if (result) {
            console.log(`[FillerV2] ✅ Success: ${item.fieldId}`);
            return { success: true };
        } else {
            console.error(`[FillerV2] ❌ Failed: ${item.fieldId}`);
            return { success: false, error: 'Fill method returned false' };
        }
    } catch (error) {
        console.error(`[FillerV2] ❌ Error filling ${item.fieldId}:`, error);
        return { success: false, error: error.message };
    }
}

/**
 * FIND ELEMENT - Simple, direct lookup
 */
function findElementV2(fieldId, action) {
    // Try ID first
    let element = document.getElementById(fieldId);
    if (element) return element;

    // Try name attribute
    element = document.querySelector(`[name="${fieldId}"]`);
    if (element) return element;

    // Try aria-label
    element = document.querySelector(`[aria-label="${fieldId}"]`);
    if (element) return element;

    // Try data-test-id or similar
    element = document.querySelector(`[data-testid="${fieldId}"], [data-test-id="${fieldId}"]`);
    if (element) return element;

    console.warn(`[FillerV2] Element not found with standard selectors: ${fieldId}`);
    return null;
}

/**
 * FILL SELECT DROPDOWN - Simple, one-shot selection
 */
async function fillSelectV2(element, item) {
    const targetValue = String(item.value || '').trim();
    if (!targetValue) {
        console.error('[FillerV2] Empty target value for select');
        return false;
    }

    console.log(`[FillerV2] Selecting: "${targetValue}" in ${element.tagName}`);

    // NATIVE SELECT
    if (element.tagName === 'SELECT') {
        return await fillNativeSelectV2(element, targetValue);
    }

    // CUSTOM DROPDOWN (React-Select, etc.)
    if (element.tagName === 'INPUT' || element.hasAttribute('role')) {
        return await fillCustomSelectV2(element, targetValue);
    }

    // DIV-BASED DROPDOWN
    if (element.tagName === 'DIV' || element.tagName === 'BUTTON') {
        return await fillCustomSelectV2(element, targetValue);
    }

    console.error('[FillerV2] Unknown select element type');
    return false;
}

/**
 * NATIVE SELECT - Direct option selection
 */
async function fillNativeSelectV2(selectElement, targetValue) {
    console.log(`[FillerV2] Native select: looking for "${targetValue}"`);

    const options = Array.from(selectElement.options);

    // Find best match
    let match = findBestOptionV2(options, targetValue);

    if (!match) {
        console.error(`[FillerV2] ❌ Option not found: "${targetValue}"`);
        console.log('[FillerV2] Available options:', options.map(o => `"${o.text}"`).join(', '));
        return false;
    }

    console.log(`[FillerV2] ✓ Found option: "${match.text}"`);

    // Select it
    selectElement.value = match.value;
    match.selected = true;

    // Fire events
    selectElement.dispatchEvent(new Event('change', { bubbles: true }));
    selectElement.dispatchEvent(new Event('input', { bubbles: true }));

    await wait(200);

    // Verify
    const isSelected = selectElement.value === match.value;
    console.log(`[FillerV2] Verification: ${isSelected ? '✅' : '❌'}`);
    return isSelected;
}

/**
 * CUSTOM SELECT - Click-based selection
 */
async function fillCustomSelectV2(element, targetValue) {
    console.log(`[FillerV2] Custom select: "${targetValue}"`);

    // Clear any existing selection first
    if (element.tagName === 'INPUT') {
        element.value = '';
        element.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(100);
    }

    // Focus and click to open menu
    element.focus();
    await wait(100);

    clickElement(element);
    await wait(300); // Wait for menu to open

    // Find dropdown menu options
    const options = findDropdownOptionsV2();
    if (!options || options.length === 0) {
        console.error('[FillerV2] ❌ No dropdown options visible');
        return false;
    }

    console.log(`[FillerV2] Found ${options.length} dropdown options`);

    // Find matching option
    const match = findBestOptionV2(options, targetValue);
    if (!match) {
        console.error(`[FillerV2] ❌ No matching option for: "${targetValue}"`);
        console.log('[FillerV2] Available:', options.slice(0, 5).map(o => `"${o.textContent?.trim()}"`));
        return false;
    }

    console.log(`[FillerV2] ✓ Found menu option: "${match.textContent?.trim()}"`);

    // Click the option
    match.scrollIntoView({ block: 'nearest' });
    clickElement(match);
    await wait(300);

    // Verify selection
    const snapshot = getSelectionSnapshotV2(element);
    const isSelected = snapshot.includes(normalizeText(targetValue));
    console.log(`[FillerV2] Verification: ${isSelected ? '✅' : '❌'} (snapshot: "${snapshot}")`);

    return isSelected;
}

/**
 * FILL CHECKBOX/RADIO - Direct click
 */
async function fillCheckboxRadioV2(element, item) {
    const isRadio = item.action.toLowerCase() === 'radio';
    const targetState = determineCheckState(item);

    console.log(`[FillerV2] ${isRadio ? 'Radio' : 'Checkbox'}: target state = ${targetState}`);

    const currentState = element.checked;

    // For radio, always click if we want it checked
    if (isRadio) {
        if (targetState) {
            element.focus();
            await wait(100);
            clickElement(element);
            element.dispatchEvent(new Event('change', { bubbles: true }));
            await wait(200);
            return element.checked === true;
        }
        return true; // Already unchecked or doesn't need to be checked
    }

    // For checkbox, only click if state needs to change
    if (currentState !== targetState) {
        element.focus();
        await wait(100);
        clickElement(element);
        element.dispatchEvent(new Event('change', { bubbles: true }));
        await wait(200);
    }

    const isCorrect = element.checked === targetState;
    console.log(`[FillerV2] Verification: ${isCorrect ? '✅' : '❌'}`);
    return isCorrect;
}

/**
 * FILL MULTI-SELECT - Select multiple options
 */
async function fillMultiSelectV2(element, item) {
    const values = Array.isArray(item.value) ? item.value : [item.value];
    console.log(`[FillerV2] Multi-select: ${values.length} values`);

    if (element.tagName === 'SELECT' && element.multiple) {
        // Native multi-select
        const options = Array.from(element.options);
        let selectedCount = 0;

        for (const targetValue of values) {
            const match = findBestOptionV2(options, targetValue);
            if (match) {
                match.selected = true;
                selectedCount++;
                console.log(`[FillerV2] ✓ Selected: "${match.text}"`);
            }
        }

        element.dispatchEvent(new Event('change', { bubbles: true }));
        await wait(200);

        return selectedCount === values.length;
    } else {
        // Custom multi-select (click each value separately)
        let successCount = 0;
        for (const value of values) {
            const success = await fillCustomSelectV2(element, value);
            if (success) successCount++;
            await wait(300); // Delay between selections
        }
        return successCount === values.length;
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function findBestOptionV2(options, targetValue) {
    const target = normalizeText(targetValue);

    // Try exact match first
    for (const opt of options) {
        const text = normalizeText(getOptionText(opt));
        if (text === target) return opt;
    }

    // Try starts-with match
    for (const opt of options) {
        const text = normalizeText(getOptionText(opt));
        if (text.startsWith(target)) return opt;
    }

    // Try includes match (but be careful with short words)
    if (target.length > 2) {
        for (const opt of options) {
            const text = normalizeText(getOptionText(opt));
            if (text.includes(target)) return opt;
        }
    }

    // Handle aliases
    if (target.includes('linkedin')) {
        for (const opt of options) {
            const text = normalizeText(getOptionText(opt));
            if (text.includes('professional network') || text.includes('online professional')) {
                return opt;
            }
        }
    }

    return null;
}

function getOptionText(option) {
    if (option.text) return option.text;
    if (option.textContent) return option.textContent;
    if (option.innerText) return option.innerText;
    if (option.value) return option.value;
    return '';
}

function normalizeText(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function findDropdownOptionsV2() {
    const selectors = [
        '[role="option"]',
        '[role="menuitem"]',
        '.select-item',
        '.menu-item',
        '.dropdown-item',
        '.autocomplete-item',
        '[class*="option"]',
        '[data-option]',
        '[id*="option"]',
        'li[role="presentation"]'
    ];

    const options = [];
    for (const selector of selectors) {
        const elements = Array.from(document.querySelectorAll(selector));
        for (const el of elements) {
            if (isVisibleV2(el) && getOptionText(el).trim()) {
                options.push(el);
            }
        }
        if (options.length > 0) break; // Stop after finding first set
    }

    return options;
}

function isVisibleV2(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 &&
           rect.height > 0 &&
           style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           parseFloat(style.opacity) > 0;
}

function clickElement(element) {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}

function getSelectionSnapshotV2(element) {
    // For INPUT elements
    if (element.value) return String(element.value);

    // For custom controls, check parent container
    const container = element.closest('[class*="select"], [role="combobox"]') || element.parentElement;
    if (container) {
        // Look for selected value display
        const valueDisplay = container.querySelector('[class*="value"], [class*="single-value"], [class*="selected"]');
        if (valueDisplay && valueDisplay.textContent) {
            return valueDisplay.textContent.trim();
        }

        // Check for chips/tags (multi-select)
        const chips = container.querySelectorAll('[class*="chip"], [class*="tag"], [class*="multi-value"]');
        if (chips.length > 0) {
            return Array.from(chips).map(c => c.textContent.trim()).join(', ');
        }
    }

    // Fallback to element text
    return element.textContent?.trim() || element.innerText?.trim() || '';
}

function determineCheckState(item) {
    const action = String(item.action || '').toLowerCase();
    const value = item.value;

    // If action is explicitly 'check', return true
    if (action === 'check') return true;

    // Parse value
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === '1' || value === 'yes' || value === 'checked') return true;
    if (value === 'false' || value === '0' || value === 'no' || value === 'unchecked') return false;

    // Default to true for radio/check actions
    return true;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Export to window
window.FieldFillerV2 = {
    fillFieldV2,
    version: '2.0'
};

console.log('[FillerV2] ✅ Ready - Simple, direct form filling');
