// Field Interaction Engine - Simulates real human clicks for all field types
console.log('Field Interaction Engine loaded');

/**
 * UNIVERSAL CLICK HELPER
 * Simulates real mouse click with full event sequence
 * This is critical for modern JS frameworks that listen to mouse events
 */
function realClick(element) {
    if (!element) {
        console.warn('[InteractionEngine] realClick: element is null');
        return false;
    }

    try {
        // Dispatch full mouse event sequence
        element.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            view: window
        }));

        element.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            view: window
        }));

        element.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
        }));

        console.log('[InteractionEngine] realClick executed on:', element);
        return true;
    } catch (error) {
        console.error('[InteractionEngine] realClick error:', error);
        return false;
    }
}

/**
 * DROPDOWN (Native <select>) - Click-based selection
 * Opens dropdown by clicking, selects option by clicking
 */
async function selectDropdownByClick(selectElement, targetValue) {
    console.log(`[InteractionEngine] selectDropdownByClick: "${targetValue}"`);

    if (!selectElement || selectElement.tagName !== 'SELECT') {
        console.error('[InteractionEngine] Not a SELECT element');
        return false;
    }

    // Step 1: Click dropdown to open it
    selectElement.focus();
    realClick(selectElement);
    await delay(200);

    // Step 2: Find matching option
    const options = Array.from(selectElement.options);
    const match = options.find(opt => {
        const optText = opt.text.trim().toLowerCase();
        const optValue = opt.value.toLowerCase();
        const target = String(targetValue).toLowerCase();
        return optText.includes(target) || optValue.includes(target) || optText === target;
    });

    if (!match) {
        console.error(`[InteractionEngine] Option not found: "${targetValue}"`);
        console.log('[InteractionEngine] Available options:', options.map(o => o.text));
        return false;
    }

    console.log(`[InteractionEngine] Found option: "${match.text}" (value: ${match.value})`);

    // Step 3: Select the option (set selected property)
    match.selected = true;
    selectElement.value = match.value;

    // Step 4: Fire events
    selectElement.dispatchEvent(new Event('change', { bubbles: true }));
    selectElement.dispatchEvent(new Event('input', { bubbles: true }));

    // Step 5: Click dropdown again to close (some frameworks need this)
    await delay(100);
    realClick(selectElement);
    selectElement.blur();

    console.log(`[InteractionEngine] ✓ Selected: "${match.text}"`);
    return true;
}

/**
 * AUTOCOMPLETE / SEARCH DROPDOWN - Type and click menu option
 * For input fields with dynamic dropdown menus
 */
async function selectAutocompleteOption(inputElement, value) {
    console.log(`[InteractionEngine] selectAutocompleteOption: "${value}"`);

    const targetValue = normalizeText(value);
    if (!targetValue) {
        console.warn('[InteractionEngine] Empty target value for autocomplete selection');
        return false;
    }

    // Clear any pre-filled value first
    inputElement.value = '';
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    await delay(80);

    inputElement.focus();
    await delay(100);

    // Open menu using real click and keyboard
    realClick(inputElement);
    inputElement.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    await delay(200);

    const listboxRoot = resolveListboxRoot(inputElement);
    const options = getVisibleOptions(listboxRoot);
    const match = findBestOptionMatch(options, targetValue);

    if (!match) {
        console.warn('[InteractionEngine] No menu option found for:', value, 'available:', options.map(opt => opt.textContent.trim()));
        return false;
    }

    console.log(`[InteractionEngine] Found menu option: "${match.textContent.trim()}"`);
    match.scrollIntoView({ block: 'nearest' });
    realClick(match);
    await delay(120);

    // Verify that control displays selected text
    const selected = normalizeText(inputElement.value || inputElement.textContent || '');
    if (selected && (selected === targetValue || selected.includes(targetValue) || targetValue.includes(selected))) {
        return true;
    }

    // Some widgets render selected value in sibling container
    const wrapper = inputElement.closest('[role="combobox"], [class*="select"], [class*="react-select"]') || inputElement.parentElement;
    const wrapperText = normalizeText(wrapper?.textContent || '');
    if (wrapperText.includes(targetValue)) {
        return true;
    }

    return false;
}

/**
 * RADIO BUTTON - Click-based selection
 */
async function selectRadioByClick(name, value) {
    console.log(`[InteractionEngine] selectRadioByClick: name="${name}", value="${value}"`);

    // Try multiple selector strategies
    const selectors = [
        `input[type="radio"][name="${name}"][value="${value}"]`,
        `input[type="radio"][name="${name}"]`
    ];

    let radioElement = null;

    for (const selector of selectors) {
        const radios = Array.from(document.querySelectorAll(selector));

        if (radios.length === 1) {
            radioElement = radios[0];
            break;
        } else if (radios.length > 1) {
            // If multiple radios, find by value or label text
            radioElement = radios.find(r => {
                if (r.value === String(value)) return true;

                // Check associated label
                const label = r.labels?.[0] || document.querySelector(`label[for="${r.id}"]`);
                if (label) {
                    const labelText = label.textContent.trim().toLowerCase();
                    const targetText = String(value).toLowerCase();
                    return labelText.includes(targetText) || labelText === targetText;
                }
                return false;
            });

            if (radioElement) break;
        }
    }

    if (!radioElement) {
        console.error(`[InteractionEngine] Radio button not found: name="${name}", value="${value}"`);
        return false;
    }

    console.log(`[InteractionEngine] Found radio: id="${radioElement.id}", value="${radioElement.value}"`);

    // Click the radio button
    radioElement.focus();
    await delay(100);
    realClick(radioElement);
    radioElement.dispatchEvent(new Event('change', { bubbles: true }));

    console.log(`[InteractionEngine] ✓ Radio selected`);
    return true;
}

/**
 * CHECKBOX - Click-based toggle
 */
async function setCheckboxByClick(checkboxElement, shouldBeChecked = true) {
    console.log(`[InteractionEngine] setCheckboxByClick: shouldBeChecked=${shouldBeChecked}`);

    if (!checkboxElement || (checkboxElement.type !== 'checkbox' && checkboxElement.type !== 'radio')) {
        console.error('[InteractionEngine] Not a checkbox/radio element');
        return false;
    }

    const currentlyChecked = checkboxElement.checked;
    console.log(`[InteractionEngine] Current state: ${currentlyChecked}`);

    if (checkboxElement.type === 'radio') {
        if (!shouldBeChecked) {
            return true;
        }

        if (!currentlyChecked) {
            checkboxElement.focus();
            await delay(100);
            realClick(checkboxElement);
            checkboxElement.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('[InteractionEngine] ✓ Radio checked');
        }
        return true;
    }

    // Only click if state needs to change
    if (currentlyChecked !== shouldBeChecked) {
        checkboxElement.focus();
        await delay(100);
        realClick(checkboxElement);
        checkboxElement.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`[InteractionEngine] ✓ Checkbox toggled to: ${shouldBeChecked}`);
    } else {
        console.log(`[InteractionEngine] Checkbox already in correct state: ${shouldBeChecked}`);
    }

    return true;
}

/**
 * MULTISELECT - Click-based multiple selection
 */
async function selectMultipleOptions(selectElement, values) {
    console.log(`[InteractionEngine] selectMultipleOptions:`, values);

    if (!selectElement || selectElement.tagName !== 'SELECT') {
        console.error('[InteractionEngine] Not a SELECT element');
        return false;
    }

    // Click to open
    realClick(selectElement);
    await delay(200);

    const options = Array.from(selectElement.options);
    let selectedCount = 0;

    for (const option of options) {
        const optText = option.text.trim().toLowerCase();
        const shouldSelect = values.some(val =>
            optText.includes(String(val).toLowerCase())
        );

        if (shouldSelect !== option.selected) {
            option.selected = shouldSelect;
            if (shouldSelect) selectedCount++;
        }
    }

    selectElement.dispatchEvent(new Event('change', { bubbles: true }));
    realClick(selectElement); // Close
    selectElement.blur();

    console.log(`[InteractionEngine] ✓ Selected ${selectedCount} options`);
    return true;
}

/**
 * DATE PICKER - Set value and trigger events
 */
async function setDateValue(inputElement, dateValue) {
    console.log(`[InteractionEngine] setDateValue: "${dateValue}"`);

    inputElement.focus();
    await delay(100);

    inputElement.value = dateValue;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    inputElement.blur();

    console.log(`[InteractionEngine] ✓ Date set: "${dateValue}"`);
    return true;
}

/**
 * TOGGLE SWITCH - Click-based toggle
 */
async function setToggleByClick(toggleElement, state = true) {
    console.log(`[InteractionEngine] setToggleByClick: state=${state}`);

    const currentState = toggleElement.checked || toggleElement.getAttribute('aria-checked') === 'true';

    if (currentState !== state) {
        realClick(toggleElement);
        await delay(100);
        console.log(`[InteractionEngine] ✓ Toggle switched to: ${state}`);
    } else {
        console.log(`[InteractionEngine] Toggle already in state: ${state}`);
    }

    return true;
}

/**
 * FILE UPLOAD - Simulate file selection
 */
async function uploadFile(inputElement, file) {
    console.log(`[InteractionEngine] uploadFile: ${file?.name || 'unknown'}`);

    if (!inputElement || inputElement.type !== 'file') {
        console.error('[InteractionEngine] Not a file input element');
        return false;
    }

    if (!file) {
        console.error('[InteractionEngine] No file provided');
        return false;
    }

    try {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        inputElement.files = dataTransfer.files;
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));

        console.log(`[InteractionEngine] ✓ File uploaded: ${file.name}`);
        return true;
    } catch (error) {
        console.error('[InteractionEngine] uploadFile error:', error);
        return false;
    }
}

/**
 * SUBMIT BUTTON - Click to submit
 */
async function clickSubmitButton(buttonElement) {
    console.log(`[InteractionEngine] clickSubmitButton`);

    if (!buttonElement) {
        console.error('[InteractionEngine] No button element');
        return false;
    }

    realClick(buttonElement);
    console.log(`[InteractionEngine] ✓ Submit button clicked`);
    return true;
}

/**
 * UTILITY: Check if element is visible
 */
function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 &&
           rect.height > 0 &&
           style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           parseFloat(style.opacity) > 0;
}

function normalizeText(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function resolveListboxRoot(inputElement) {
    const ariaControls = inputElement.getAttribute('aria-controls');
    if (ariaControls) {
        const byId = document.getElementById(ariaControls);
        if (byId) {
            return byId;
        }
    }

    const expandedRegion = inputElement.closest('[aria-expanded="true"], [role="combobox"]');
    const scopedListbox = expandedRegion?.querySelector('[role="listbox"]');
    if (scopedListbox) {
        return scopedListbox;
    }

    return document;
}

function getVisibleOptions(rootNode) {
    const optionSelectors = [
        '[role="option"]',
        '[role="menuitem"]',
        '.menu-item',
        '.autocomplete-item',
        '.dropdown-item',
        '[data-option]',
        '[id*="option"]'
    ];

    return Array.from(rootNode.querySelectorAll(optionSelectors.join(', ')))
        .filter(isVisible)
        .filter(opt => normalizeText(opt.textContent));
}

function findBestOptionMatch(options, targetValue) {
    const exact = options.find(opt => normalizeText(opt.textContent) === targetValue);
    if (exact) return exact;

    const startsWith = options.find(opt => normalizeText(opt.textContent).startsWith(targetValue));
    if (startsWith) return startsWith;

    return options.find(opt => normalizeText(opt.textContent).includes(targetValue)) || null;
}

/**
 * UTILITY: Delay helper
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * UNIVERSAL FIELD ACTION EXECUTOR
 * This is the main function that routes to the correct handler
 */
async function applyFieldAction(fieldType, element, value, actionType = 'type') {
    console.log(`[InteractionEngine] applyFieldAction: type="${fieldType}", action="${actionType}", value="${value}"`);

    try {
        // Scroll into view first
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await delay(200);

        // Route to appropriate handler based on field type and action
        switch (actionType) {
            case 'select':
                if (element.tagName === 'SELECT') {
                    return await selectDropdownByClick(element, value);
                } else if (element.getAttribute('role') === 'combobox' ||
                           element.type === 'text' && fieldType.includes('search')) {
                    return await selectAutocompleteOption(element, value);
                } else {
                    // Custom dropdown - try existing logic
                    return await selectDropdownByClick(element, value);
                }

            case 'check':
                const shouldCheck = normalizeCheckboxIntent(value, actionType);
                return await setCheckboxByClick(element, shouldCheck);

            case 'radio':
                return await selectRadioByClick(element.name, value);

            case 'upload':
                // File upload handled separately
                console.log('[InteractionEngine] File upload - requires separate handling');
                return false;

            case 'date':
                return await setDateValue(element, value);

            case 'toggle':
                const toggleState = value === true || value === 'true' || value === 'on';
                return await setToggleByClick(element, toggleState);

            case 'submit':
                return await clickSubmitButton(element);

            case 'type':
            default:
                // Text fields handled by existing humanLikeType() in content-script.js
                console.log('[InteractionEngine] Text field - handled by content-script.js');
                return false; // Let content-script handle it
        }
    } catch (error) {
        console.error('[InteractionEngine] applyFieldAction error:', error);
        return false;
    }
}

// Export to window for use by content-script.js
window.FieldInteractionEngine = {
    realClick,
    selectDropdownByClick,
    selectAutocompleteOption,
    selectRadioByClick,
    setCheckboxByClick,
    selectMultipleOptions,
    setDateValue,
    setToggleByClick,
    uploadFile,
    clickSubmitButton,
    applyFieldAction,
    isVisible,
    delay
};

console.log('[InteractionEngine] ✓ Module ready - All interaction methods exported');

function normalizeCheckboxIntent(value, actionType) {
    const action = String(actionType || '').toLowerCase();
    if (action === 'check') {
        return true;
    }
    if (action === 'uncheck') {
        return false;
    }

    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return ['true', '1', 'yes', 'y', 'checked'].includes(normalized);
    }
    return true;
}
