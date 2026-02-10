// Content script - injected into job application pages
// Handles form detection, field filling, and stealth behavior

console.log('Jobs AI Content Script loaded');

let isPaused = false;
let isProcessing = false;
let currentFillPlan = [];
let captchaDetected = false;
const captchaEnabled = false;

if (!window.__JOBS_AI_LISTENER_ATTACHED__) {
    // Listen for messages from background/sidepanel
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('Content script received:', message.action);

        switch (message.action) {
            case 'scanPage':
                handleScanPage(sendResponse);
                return true;

            case 'startFilling':
                handleStartFilling(message.data, sendResponse);
                return true;

            case 'pause':
                isPaused = true;
                sendResponse({ success: true });
                break;

            case 'resume':
                isPaused = false;
                if (currentFillPlan.length > 0) {
                    continueFilling();
                }
                sendResponse({ success: true });
                break;

            case 'detectCaptcha':
                detectCaptcha(sendResponse);
                return true;

            default:
                return false;
        }
    });
    window.__JOBS_AI_LISTENER_ATTACHED__ = true;
} else {
    console.log('[JobsAI] Message listener already attached; skipping duplicate setup');
}

// Scan page for form fields
async function handleScanPage(sendResponse) {
    try {
        const fields = await detectFormFields();
        sendResponse({ success: true, fields });
    } catch (error) {
        console.error('Scan error:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Detect all form fields on the page
async function detectFormFields() {
    const fields = [];
    const formElements = document.querySelectorAll('input, select, textarea');

    console.log(`[DEBUG] Found ${formElements.length} form elements on page`);

    for (const element of formElements) {
        // Skip hidden, disabled, or readonly fields
        if (element.type === 'hidden' || element.disabled || element.readOnly) {
            continue;
        }

        // Skip submit buttons
        if (element.type === 'submit' || element.type === 'button') {
            continue;
        }

        const generatedId = element.id || generateFieldId(element);
        const controlType = detectControlType(element);
        const normalizedType = controlType === 'menu'
            ? 'select'
            : (element.type || element.tagName.toLowerCase());
        
        const field = {
            id: generatedId,
            name: element.name || '',
            type: normalizedType,
            controlType,
            label: getFieldLabel(element),
            placeholder: element.placeholder || '',
            required: element.required || element.hasAttribute('aria-required'),
            value: element.value || '',
            options: [],
            // Store original attributes for reliable lookup
            originalId: element.id || null,
            selector: generateSelector(element)
        };

        console.log(`[DEBUG] Scanned field: id="${field.id}", originalId="${field.originalId}", name="${field.name}", selector="${field.selector}"`);

        // For select elements, get all options
        if (element.tagName === 'SELECT') {
            field.options = Array.from(element.options).map(opt => ({
                value: opt.value,
                text: opt.text
            }));
        }

        // For custom menu controls, collect visible options if present in DOM
        if (controlType === 'menu' && field.options.length === 0) {
            field.options = extractMenuOptions(element);
        }

        // For radio buttons, get all options in the group
        if (element.type === 'radio') {
            const radioGroup = document.querySelectorAll(`input[name="${element.name}"]`);
            field.options = Array.from(radioGroup).map(radio => ({
                value: radio.value,
                label: getFieldLabel(radio)
            }));
        }

        console.log(`[DEBUG] Field controlType="${field.controlType}", type="${field.type}", options=${field.options.length}`);
        fields.push(field);
    }

    console.log(`[DEBUG] Total fields detected: ${fields.length}`);

    // Log full scan results for user visibility
    if (window.logFull) {
        window.logFull('COMPLETE FIELD SCAN RESULTS', {
            totalFields: fields.length,
            timestamp: new Date().toISOString(),
            pageUrl: window.location.href,
            fields: fields.map(f => ({
                id: f.id,
                label: f.label,
                type: f.type,
                name: f.name,
                required: f.required,
                hasOptions: f.options && f.options.length > 0,
                optionCount: f.options ? f.options.length : 0,
                options: f.options || []
            }))
        });
    }

    return fields;
}

function detectControlType(element) {
    if (!element) return 'text';

    const tag = element.tagName.toLowerCase();
    const type = (element.type || '').toLowerCase();
    const role = (element.getAttribute('role') || '').toLowerCase();
    const ariaHaspopup = (element.getAttribute('aria-haspopup') || '').toLowerCase();
    const placeholder = (element.placeholder || '').toLowerCase();
    const id = (element.id || '').toLowerCase();

    if (tag === 'select') return 'menu';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (tag === 'textarea') return 'textarea';

    const isCustomMenu = role === 'combobox' ||
        ariaHaspopup === 'listbox' ||
        id.startsWith('field_select____') ||
        placeholder === 'select...' ||
        element.closest('[role="combobox"], [aria-haspopup="listbox"], [data-testid*="select"]');

    if (isCustomMenu) return 'menu';

    return 'text';
}

function extractMenuOptions(element) {
    const options = [];
    const addOption = (value, text) => {
        if (!text) return;
        if (options.some(opt => opt.text === text)) return;
        options.push({ value: value || text, text });
    };

    const listboxId = element.getAttribute('aria-controls');
    const scopedRoot = listboxId ? document.getElementById(listboxId) : null;
    const questionRoot = element.closest('fieldset, [class*="question"], [data-testid*="question"], .application-question');
    const scanRoot = scopedRoot || questionRoot || element.parentElement || document;
    const optionNodes = Array.from(scanRoot.querySelectorAll('[role="option"], [role="menuitem"], option'))
        .filter(node => node.tagName === 'OPTION' || isVisibleElement(node));

    for (const node of optionNodes) {
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        addOption(node.value, text);
    }

    return options;
}

// Get label for a field
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

// Generate unique field ID
function generateFieldId(element) {
    const label = getFieldLabel(element);
    const sanitized = label.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return `field_${sanitized}_${Math.random().toString(36).substr(2, 5)}`;
}

// Generate a CSS selector for an element
function generateSelector(element) {
    // If element has an ID, use it
    if (element.id) {
        return `#${element.id}`;
    }
    
    // If element has a name, use it
    if (element.name) {
        return `[name="${element.name}"]`;
    }
    
    // Build a selector based on tag, type, and position
    const tag = element.tagName.toLowerCase();
    let selector = tag;
    
    if (element.type) {
        selector += `[type="${element.type}"]`;
    }
    
    if (element.placeholder) {
        selector += `[placeholder="${element.placeholder}"]`;
    }
    
    // If still not unique enough, add nth-of-type
    const matches = document.querySelectorAll(selector);
    if (matches.length > 1) {
        const index = Array.from(matches).indexOf(element);
        if (index >= 0) {
            selector = `${selector}:nth-of-type(${index + 1})`;
        }
    }
    
    return selector;
}

// Start filling form with AI-generated plan
async function handleStartFilling(data, sendResponse) {
    if (isProcessing) {
        sendResponse({ success: false, error: 'Already processing' });
        return;
    }

    try {
        isProcessing = true;
        currentFillPlan = data.fillPlan || [];
        
        // Store field metadata for lookup
        window.fieldMetadata = {};
        if (data.fields) {
            data.fields.forEach(field => {
                window.fieldMetadata[field.id] = field;
            });
            console.log(`[DEBUG] Stored metadata for ${Object.keys(window.fieldMetadata).length} fields`);
        }

        await executeFillPlan(currentFillPlan);

        isProcessing = false;
        sendResponse({ success: true });
    } catch (error) {
        console.error('Filling error:', error);
        isProcessing = false;
        sendResponse({ success: false, error: error.message });
    }
}

// Execute the fill plan
async function executeFillPlan(fillPlan) {
    for (let i = 0; i < fillPlan.length; i++) {
        // Check for pause
        if (isPaused) {
            console.log('Filling paused');
            notifySidePanel({ type: 'paused', at: i });
            return;
        }

        // Check for captcha
        if (await detectCaptchaSync()) {
            console.log('Captcha detected - pausing');
            captchaDetected = true;
            isPaused = true;
            notifySidePanel({ type: 'captcha_detected' });
            return;
        }

        const item = fillPlan[i];

        try {
            notifySidePanel({ type: 'filling', field: item.fieldId, action: item.action });

            await fillField(item);

            // Log success
            logAction({
                action: 'filled',
                fieldId: item.fieldId,
                value: item.value,
                success: true
            });

            notifySidePanel({ type: 'filled', field: item.fieldId });

        } catch (error) {
            console.error(`Error filling ${item.fieldId}:`, error);

            logAction({
                action: 'failed',
                fieldId: item.fieldId,
                error: error.message,
                success: false
            });

            notifySidePanel({ type: 'error', field: item.fieldId, error: error.message });
        }

        // Human-like delay between fields
        await randomDelay(300, 800);
    }

    notifySidePanel({ type: 'complete' });
}

// Fill a single field based on action type
async function fillField(item) {
    const element = findElement(item.fieldId, item.action);

    if (!element) {
        throw new Error(`Element not found: ${item.fieldId}`);
    }

    // Scroll element into view
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await randomDelay(200, 400);

    switch (item.action) {
        case 'type':
            await humanLikeType(element, item.value);
            break;

        case 'select':
            await selectOption(element, item.value);
            break;

        case 'check':
            await checkBox(element, item);
            break;

        case 'upload':
            // File upload handled separately by user
            notifySidePanel({ type: 'upload_needed', field: item.fieldId });
            break;

        case 'skip':
            console.log(`Skipping field: ${item.fieldId}`);
            break;

        default:
            console.warn(`Unknown action: ${item.action}`);
    }
}

// Human-like typing simulation
async function humanLikeType(element, text) {
    element.focus();
    await randomDelay(100, 300);

    // Clear existing value
    element.value = '';
    element.dispatchEvent(new Event('input', { bubbles: true }));

    // Type character by character
    for (const char of text) {
        element.value += char;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        await randomDelay(50, 150);
    }

    // Trigger change event
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.blur();
    await randomDelay(100, 200);
}

// Select option from dropdown - CLICK-BASED APPROACH
async function selectOption(element, value) {
    console.log(`[ContentScript] selectOption: element=${element.tagName}, value="${value}"`);

    // Use the new click-based interaction engine
    if (window.FieldInteractionEngine) {
        if (element.tagName === 'SELECT') {
            // Native select dropdown - use click-based selection
            const success = await window.FieldInteractionEngine.selectDropdownByClick(element, value);
            if (success) {
                console.log('[ContentScript] ✓ Dropdown selected using click-based engine');
                return;
            }
            // If failed, fall through to old method as backup
            console.warn('[ContentScript] Click-based selection failed, trying fallback');
        } else if (
            element.tagName === 'INPUT' ||
            element.tagName === 'TEXTAREA' ||
            (element.getAttribute('role') || '').toLowerCase() === 'combobox'
        ) {
            // Autocomplete or text-backed custom dropdown
            const success = await window.FieldInteractionEngine.selectAutocompleteOption(element, value);
            if (success) {
                console.log('[ContentScript] ✓ Autocomplete selected using click-based engine');
                return;
            }
            // If failed, fall through to custom click fallback
            console.warn('[ContentScript] Autocomplete selection failed, trying fallback');
        } else {
            console.log('[ContentScript] Non-input menu trigger detected; using custom click fallback');
        }
    } else {
        console.warn('[ContentScript] FieldInteractionEngine not loaded, using fallback');
    }

    // FALLBACK: Old method (in case new engine fails)
    element.focus();
    await randomDelay(100, 200);

    if (element.tagName === 'SELECT') {
        // Native select handling (old method)
        const options = Array.from(element.options);
        const match = options.find(opt =>
            opt.value === value ||
            opt.text.toLowerCase().includes(String(value).toLowerCase())
        );

        if (match) {
            element.value = match.value;
            element.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            throw new Error(`Option not found: ${value}`);
        }
    } else {
        // Custom menu handling (combobox, listbox, button menus)
        await selectCustomOption(element, value);
    }

    element.blur();
    await randomDelay(100, 200);
}

async function selectCustomOption(element, value) {
    const targetValue = normalizeOptionText(value);
    if (!targetValue) {
        throw new Error(`Invalid option value: ${value}`);
    }

    const trigger = findMenuTrigger(element);
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    trigger.click();
    await randomDelay(150, 300);

    const listboxId = trigger.getAttribute('aria-controls') || element.getAttribute('aria-controls');
    const scopedRoot = listboxId ? document.getElementById(listboxId) : null;
    let option = findVisibleOptionByText(targetValue, scopedRoot || document);
    if (!option) {
        option = findInlineChoice(element, targetValue);
    }

    if (!option) {
        throw new Error(`Custom option not found: ${value}`);
    }

    option.click();
    option.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    if (typeof element.value === 'string' && !element.value) {
        element.value = option.textContent.trim();
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

function findMenuTrigger(element) {
    const selector = [
        '[role="combobox"]',
        'button[aria-haspopup="listbox"]',
        'button[aria-haspopup="menu"]',
        '[aria-haspopup="listbox"]'
    ].join(', ');

    if (element.matches(selector)) {
        return element;
    }

    const nearby = element.closest('label, div, fieldset')?.querySelector(selector);
    return nearby || element;
}

function findVisibleOptionByText(targetText, rootNode = document) {
    const optionSelectors = [
        '[role="option"]',
        '[role="menuitem"]',
        '[role="menuitemradio"]',
        '[role="listbox"] [tabindex]',
        '.select__option'
    ];

    const candidates = Array.from(rootNode.querySelectorAll(optionSelectors.join(', ')))
        .filter(isVisibleElement)
        .filter(node => normalizeOptionText(node.textContent));

    return pickBestOptionMatch(candidates, targetText);
}

function findInlineChoice(element, targetText) {
    const questionRoot = element.closest('fieldset, [class*="question"], [data-testid*="question"], .application-question') || document;
    const inlineCandidates = Array.from(questionRoot.querySelectorAll('button, label, [role="radio"], [role="button"]'))
        .filter(isVisibleElement)
        .filter(node => normalizeOptionText(node.textContent));

    return pickBestOptionMatch(inlineCandidates, targetText);
}

function pickBestOptionMatch(candidates, targetText) {
    const exact = candidates.find(node => normalizeOptionText(node.textContent) === targetText);
    if (exact) return exact;

    const startsWith = candidates.find(node => normalizeOptionText(node.textContent).startsWith(targetText));
    if (startsWith) return startsWith;

    return candidates.find(node => normalizeOptionText(node.textContent).includes(targetText)) || null;
}

function normalizeOptionText(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function isVisibleElement(node) {
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);

    return rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0';
}

// Check/uncheck checkbox - CLICK-BASED APPROACH
async function checkBox(element, item) {
    const shouldCheck = normalizeShouldBeChecked(item);
    console.log(`[ContentScript] checkBox: shouldCheck=${shouldCheck}`);

    // Use the new click-based interaction engine
    if (window.FieldInteractionEngine) {
        const success = await window.FieldInteractionEngine.setCheckboxByClick(element, shouldCheck);
        if (success) {
            console.log('[ContentScript] ✓ Checkbox set using click-based engine');
            return;
        }
        // If failed, fall through to old method as backup
        console.warn('[ContentScript] Click-based checkbox failed, trying fallback');
    } else {
        console.warn('[ContentScript] FieldInteractionEngine not loaded, using fallback');
    }

    // FALLBACK: Old method (in case new engine fails)
    element.focus();
    await randomDelay(100, 200);

    if (element.checked !== shouldCheck) {
        element.click();
        await randomDelay(50, 100);
    }

    element.blur();
}

function normalizeShouldBeChecked(item) {
    const action = String(item?.action || '').toLowerCase();
    if (action === 'check') return true;
    if (action === 'uncheck') return false;

    const value = item?.value;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return ['true', '1', 'yes', 'y', 'checked'].includes(normalized);
    }
    return true;
}

// Find element by ID or fallback methods
function findElement(fieldId, action = '') {
    console.log(`[DEBUG] Looking for element with fieldId: ${fieldId}, action=${action}`);
    const actionType = String(action || '').toLowerCase();
    const isMenuAction = actionType === 'select';
    const isBooleanAction = actionType === 'check' || actionType === 'radio';
    
    // Get stored metadata for this field
    const fieldData = window.fieldMetadata ? window.fieldMetadata[fieldId] : null;
    
    if (fieldData) {
        console.log(`[DEBUG] Found metadata: originalId="${fieldData.originalId}", name="${fieldData.name}", selector="${fieldData.selector}"`);
        
        // Try original ID first
        if (fieldData.originalId) {
            let element = document.getElementById(fieldData.originalId);
            if (element) {
                console.log(`[DEBUG] Found element by originalId: ${fieldData.originalId}`);
                return element;
            }
        }
        
        // Try name attribute
        if (fieldData.name) {
            let element = document.querySelector(`[name="${fieldData.name}"]`);
            if (element) {
                console.log(`[DEBUG] Found element by name: ${fieldData.name}`);
                return element;
            }
        }
        
        // Try stored selector
        if (fieldData.selector) {
            if ((isMenuAction || isBooleanAction) && isGenericSelector(fieldData.selector)) {
                console.log(`[DEBUG] Skipping generic selector for ${actionType}: ${fieldData.selector}`);
            } else {
                try {
                    let element = document.querySelector(fieldData.selector);
                    if (element) {
                        if (isMenuAction) {
                            element = resolveAssociatedMenuElement(element);
                            if (!element) {
                                console.warn(`[DEBUG] Selector resolved non-menu element for ${fieldId}`);
                            } else {
                                console.log(`[DEBUG] Found menu element by selector: ${fieldData.selector}`);
                                return element;
                            }
                        } else {
                            console.log(`[DEBUG] Found element by selector: ${fieldData.selector}`);
                            return element;
                        }
                    }
                } catch (e) {
                    console.warn(`[DEBUG] Invalid selector: ${fieldData.selector}`, e);
                }
            }
        }
    }
    
    // Fallback to old method
    console.log(`[DEBUG] Trying fallback methods for: ${fieldId}`);
    
    // Try direct ID
    let element = document.getElementById(fieldId);
    if (element) {
        if (isMenuAction) {
            const menuElement = resolveAssociatedMenuElement(element);
            if (menuElement) {
                console.log(`[DEBUG] Found menu element by direct ID`);
                return menuElement;
            }
            console.warn(`[DEBUG] Direct ID is not a menu control for ${fieldId}`);
        } else {
            console.log(`[DEBUG] Found element by direct ID`);
            return element;
        }
    }

    // Try name attribute
    element = document.querySelector(`[name="${fieldId}"]`);
    if (element) {
        if (isMenuAction) {
            const menuElement = resolveAssociatedMenuElement(element);
            if (menuElement) {
                console.log(`[DEBUG] Found menu element by name attribute`);
                return menuElement;
            }
            console.warn(`[DEBUG] Name attribute resolved non-menu element for ${fieldId}`);
        } else {
            console.log(`[DEBUG] Found element by name attribute`);
            return element;
        }
    }

    // Try data attribute
    element = document.querySelector(`[data-field-id="${fieldId}"]`);
    if (element) {
        if (isMenuAction) {
            const menuElement = resolveAssociatedMenuElement(element);
            if (menuElement) {
                console.log(`[DEBUG] Found menu element by data attribute`);
                return menuElement;
            }
            console.warn(`[DEBUG] Data attribute resolved non-menu element for ${fieldId}`);
        } else {
            console.log(`[DEBUG] Found element by data attribute`);
            return element;
        }
    }

    // Do not fallback to broad selectors for menu/checkbox/radio actions
    if (isMenuAction || isBooleanAction) {
        console.warn(`[DEBUG] Strict lookup failed for ${actionType} field: ${fieldId}`);
        return null;
    }

    console.error(`[DEBUG] Element not found for fieldId: ${fieldId}`);
    return null;
}

function isGenericSelector(selector = '') {
    const trimmed = selector.trim().toLowerCase();
    return trimmed === 'input' ||
        trimmed === 'textarea' ||
        trimmed === 'select' ||
        trimmed === 'input[type="text"]' ||
        trimmed.startsWith('input[type="text"]:nth-of-type');
}

function resolveAssociatedMenuElement(element) {
    if (!element) return null;
    if (isMenuLikeElement(element)) return element;

    const questionRoot = element.closest('fieldset, [class*="question"], [data-testid*="question"], .application-question') ||
        element.closest('label, div') ||
        document;

    const candidates = Array.from(questionRoot.querySelectorAll(
        '[role="combobox"], [aria-haspopup="listbox"], button[aria-haspopup="listbox"], select, [id^="field_select____"]'
    ));

    const visibleCandidate = candidates.find(node => isMenuLikeElement(node));
    return visibleCandidate || null;
}

function isMenuLikeElement(element) {
    if (!element) return false;
    if (element.tagName === 'SELECT') return true;

    const role = (element.getAttribute('role') || '').toLowerCase();
    const ariaHasPopup = (element.getAttribute('aria-haspopup') || '').toLowerCase();
    const id = (element.id || '').toLowerCase();
    return role === 'combobox' ||
        ariaHasPopup === 'listbox' ||
        id.startsWith('field_select____');
}

// Detect CAPTCHA on page - only if visible and active
async function detectCaptchaSync() {
    if (!captchaEnabled) {
        return false;
    }
    // Check for common captcha indicators
    const captchaSelectors = [
        'iframe[src*="recaptcha"]',
        'iframe[src*="hcaptcha"]',
        '.g-recaptcha',
        '.h-captcha',
        '#recaptcha'
    ];

    for (const selector of captchaSelectors) {
        const element = document.querySelector(selector);
        if (element) {
            // Check if element is actually visible
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);

            const isVisible = (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0'
            );

            if (isVisible) {
                // For iframes, check if they have actual content loaded
                if (element.tagName === 'IFRAME') {
                    // Check if iframe is in viewport and has reasonable size
                    if (rect.width > 100 && rect.height > 50) {
                        console.log('Active CAPTCHA detected:', selector);
                        return true;
                    }
                } else {
                    // For div-based captchas, check if they're showing the challenge
                    const hasChallenge = element.querySelector('[role="presentation"]') ||
                        element.querySelector('.recaptcha-checkbox') ||
                        element.querySelector('.h-captcha-checkbox');
                    if (hasChallenge) {
                        console.log('Active CAPTCHA detected:', selector);
                        return true;
                    }
                }
            }
        }
    }

    return false;
}

function detectCaptcha(sendResponse) {
    detectCaptchaSync().then(detected => {
        sendResponse({ detected });
    });
}

// Continue filling after pause/resume
async function continueFilling() {
    if (currentFillPlan.length > 0) {
        await executeFillPlan(currentFillPlan);
    }
}

// Random delay for human-like behavior
function randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
}

// Notify side panel of events
function notifySidePanel(data) {
    chrome.runtime.sendMessage({
        action: 'notifySidePanel',
        data
    });
}

// Log action to history
function logAction(data) {
    chrome.runtime.sendMessage({
        action: 'logAction',
        data: {
            ...data,
            url: window.location.href
        }
    });
}

// Periodic captcha check
if (!window.__JOBS_AI_CAPTCHA_INTERVAL__) {
    window.__JOBS_AI_CAPTCHA_INTERVAL__ = setInterval(async () => {
        if (isProcessing && !isPaused) {
            const detected = await detectCaptchaSync();
            if (detected && !captchaDetected) {
                captchaDetected = true;
                isPaused = true;
                notifySidePanel({ type: 'captcha_detected' });
            }
        }
    }, 2000);
}
