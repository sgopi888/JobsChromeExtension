// Side panel UI controller
let chatHistory = [];
let currentFields = [];
let currentSession = null;

// DOM Elements
const scanBtn = document.getElementById('scanBtn');
const fillBtn = document.getElementById('fillBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');
const statusBadge = document.getElementById('statusBadge');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const chatMessages = document.getElementById('chatMessages');
const logMessages = document.getElementById('logMessages');
const autoContinue = document.getElementById('autoContinue');
const autoSubmit = document.getElementById('autoSubmit');
const clearLogBtn = document.getElementById('clearLogBtn');
const importProfileTxtBtn = document.getElementById('importProfileTxtBtn');

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        switchTab(tab);
    });
});

function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`${tabName}Tab`).classList.add('active');
}

// Scan page for form fields
scanBtn.addEventListener('click', async () => {
    updateStatus('Scanning...');
    addSystemMessage('Starting pipeline scan...');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const requestContext = {
        url: tab.url || '',
        startedAt: new Date().toISOString(),
        pipelineEndpoint: 'http://127.0.0.1:8877/pipeline',
        activeTabUrl: tab.url || '',
        pageTitle: tab.title || ''
    };
    updateContextDisplay('pipelineRequestContext', JSON.stringify(requestContext, null, 2));
    addSystemMessage(`Pipeline request queued for: ${requestContext.url}`);
    addAssistantMessage(`Pipeline request context:\n${JSON.stringify(requestContext, null, 2)}`);

    // Call Python pipeline first (no browser scan required for values).
    await pipelineScanFromBackend(requestContext);

    // Keep DOM scan as a best-effort locator helper for filling (selectors/originalId),
    // but do not treat it as a source of truth for values.
    addSystemMessage('Locating fields on page (DOM scan)...');
    chrome.tabs.sendMessage(tab.id, { action: 'scanPage' }, async (response) => {
        if (response && response.success) {
            currentFields = response.fields;
            await chrome.runtime.sendMessage({
                action: 'updateSession',
                data: {
                    fields: response.fields,
                    currentUrl: tab.url || ''
                }
            });
            addSystemMessage(`DOM scan found ${response.fields.length} fields (locator metadata only).`);
            updateContextDisplay('fieldsContext', JSON.stringify(response.fields, null, 2));
        } else {
            addSystemMessage('DOM scan failed (filling may still work via direct ids).', 'warn');
        }
    });
});

async function pipelineScanFromBackend(requestContext) {
    addSystemMessage('Calling local pipeline backend...', 'info');
    updateStatus('Pipeline...');

    const response = await chrome.runtime.sendMessage({
        action: 'pipelineScan',
        data: {
            url: requestContext.url,
            scanFieldCount: requestContext.scanFieldCount,
            pageTitle: requestContext.pageTitle
        }
    });

    if (response && response.success) {
        const pipelineMaster = response.pipelineMaster;
        const fillPlan = Array.isArray(response.fillPlan) ? response.fillPlan : [];
        const counts = response.counts || {};

        updateContextDisplay('pipelineMasterContext', JSON.stringify(pipelineMaster, null, 2));
        updateContextDisplay('fillPlanContext', JSON.stringify(fillPlan, null, 2));

        const filledCount = Array.isArray(pipelineMaster?.filled_fields) ? pipelineMaster.filled_fields.length : 0;
        addSystemMessage(`Pipeline response received (${filledCount} fields). Stored as master JSON.`);
        addAssistantMessage(`Pipeline response (master JSON):\n${JSON.stringify(pipelineMaster, null, 2)}`);
        addSystemMessage(`Fill plan ready: ${counts.typeCount || 0} text, ${counts.selectCount || 0} selects, ${counts.checkCount || 0} checks, ${counts.uploadCount || 0} uploads.`);

        // Enable fill buttons
        if (window.ButtonManager) {
            window.ButtonManager.enableButtons();
        }
        fillBtn.disabled = false;
        updateStatus('Ready');
    } else {
        addSystemMessage(`Pipeline error: ${response?.error || 'Unknown error'}`, 'error');
        updateStatus('Error');
    }
}

// Analyze fields with AI
async function analyzeFields(fields) {
    addSystemMessage('Analyzing fields with AI...');

    const response = await chrome.runtime.sendMessage({
        action: 'analyzeFields',
        data: { fields }
    });

    if (response && response.success) {
        addSystemMessage(`AI generated fill plan for ${response.fillPlan.length} fields`);
        if (response.debug?.requestContext) {
            updateContextDisplay('llmRequestContext', JSON.stringify(response.debug.requestContext, null, 2));
        }
        if (response.debug?.responseContext) {
            updateContextDisplay('llmResponseContext', JSON.stringify(response.debug.responseContext, null, 2));
        }

        if (response.missingInfo && response.missingInfo.length > 0) {
            addAssistantMessage(`I need some information:\n${response.missingInfo.join('\n')}`);
        }

        if (response.warnings && response.warnings.length > 0) {
            addSystemMessage(`Warnings: ${response.warnings.join(', ')}`);
        }

        // Enable split fill buttons if available
        if (window.ButtonManager) {
            window.ButtonManager.enableButtons();
        }
        fillBtn.disabled = false; // Keep for backward compatibility
        updateStatus('Ready');
    } else {
        addSystemMessage('Error analyzing fields', 'error');
        updateStatus('Error');
    }
}

// Start filling
fillBtn.addEventListener('click', async () => {
    const state = await getState();

    if (!state.session || !state.session.fillPlan) {
        addSystemMessage('No fill plan available. Scan page first.', 'error');
        return;
    }

    updateStatus('Filling...');
    addSystemMessage('Starting form filling...');
    addAssistantMessage(`Fill started.\nMode: Full\nItems: ${state.session.fillPlan.length}`);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.tabs.sendMessage(tab.id, {
        action: 'startFilling',
        data: {
            fillPlan: state.session.fillPlan,
            fields: currentFields,  // Pass field metadata for lookup
            mode: 'full'
        }
    }, (response) => {
        if (response && response.success) {
            addSystemMessage('Filling complete!');
            updateStatus('Complete');
            addAssistantMessage('Fill complete.');
        } else {
            addSystemMessage('Filling encountered errors', 'error');
            updateStatus('Error');
            addAssistantMessage(`Fill error: ${response?.error || 'Unknown error'}`);
        }
    });

    pauseBtn.disabled = false;
    fillBtn.disabled = true;
});

// Pause
pauseBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'pauseFilling' }, (response) => {
        if (response.success) {
            addSystemMessage('Paused');
            updateStatus('Paused');
            pauseBtn.disabled = true;
            resumeBtn.disabled = false;
        }
    });
});

// Resume
resumeBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'resumeFilling' }, (response) => {
        if (response.success) {
            addSystemMessage('Resumed');
            updateStatus('Filling...');
            pauseBtn.disabled = false;
            resumeBtn.disabled = true;
        }
    });
});

// Chat
sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;

    addUserMessage(message);
    chatInput.value = '';
    const userEntry = { role: 'user', content: message };
    chatHistory.push(userEntry);
    await persistChatHistory();

    // Extract user information from message
    await extractAndSaveUserInfo(message);

    const response = await chrome.runtime.sendMessage({
        action: 'chat',
        data: { message, history: chatHistory.slice(0, -1) }
    });

    if (response && response.success) {
        addAssistantMessage(response.response);
        chatHistory.push({ role: 'assistant', content: response.response });
        await persistChatHistory();

        // Also extract from AI response
        await extractAndSaveUserInfo(response.response);
    } else {
        addSystemMessage('Chat error', 'error');
    }
}

// Extract and save user information from text
async function extractAndSaveUserInfo(text) {
    const state = await getState();
    const profile = state.profile || {};
    const qaLibrary = state.qaLibrary || {};
    let updated = false;

    // Extract full name (various patterns)
    if (!profile.name) {
        const namePatterns = [
            /(?:my name is|i'm|i am|name:\s*|first name:\s*)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
            /^([A-Z][a-z]+\s+[A-Z][a-z]+)\s*$/m, // Name on its own line
            /First Name[:\s]+([A-Z][a-z]+).*Last Name[:\s]+([A-Z][a-z]+)/i
        ];

        for (const pattern of namePatterns) {
            const match = text.match(pattern);
            if (match) {
                profile.name = match[1] + (match[2] ? ' ' + match[2] : '');
                updated = true;
                break;
            }
        }
    }

    // Extract email
    const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
    if (emailMatch && !profile.email) {
        profile.email = emailMatch[0];
        updated = true;
    }

    // Extract phone (multiple formats)
    const phoneMatch = text.match(/\b(\+?1?[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/);
    if (phoneMatch && !profile.phone) {
        profile.phone = phoneMatch[0].replace(/\s+/g, '');
        updated = true;
    }

    // Extract location (city, state, country)
    const locationPatterns = [
        /(?:from|in|located in|location:\s*|city:\s*)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:,\s*[A-Z]{2})?(?:,\s*USA)?)/i,
        /([A-Z][a-z]+),\s*([A-Z]{2})\s*\d{5}/,  // City, ST ZIP
        /Atlanta Metropolitan Area|San Francisco|New York/i
    ];

    if (!profile.location) {
        for (const pattern of locationPatterns) {
            const match = text.match(pattern);
            if (match) {
                profile.location = match[1] || match[0];
                updated = true;
                break;
            }
        }
    }

    // Extract current company
    const companyMatch = text.match(/(?:current company|working at|employed at|company:\s*)\s*([A-Z][A-Za-z\s&]+)/i);
    if (companyMatch && !profile.company) {
        profile.company = companyMatch[1].trim();
        updated = true;
    }

    // Extract LinkedIn
    const linkedinMatch = text.match(/linkedin\.com\/in\/([a-zA-Z0-9-]+)/);
    if (linkedinMatch && !profile.linkedin) {
        profile.linkedin = `https://linkedin.com/in/${linkedinMatch[1]}`;
        updated = true;
    }

    // Extract GitHub
    const githubMatch = text.match(/github\.com\/([a-zA-Z0-9-]+)/);
    if (githubMatch && !profile.github) {
        profile.github = `https://github.com/${githubMatch[1]}`;
        updated = true;
    }

    // Extract Twitter
    const twitterMatch = text.match(/twitter\.com\/([a-zA-Z0-9_]+)/);
    if (twitterMatch && !profile.twitter) {
        profile.twitter = `https://twitter.com/${twitterMatch[1]}`;
        updated = true;
    }

    // Extract portfolio/website
    const websiteMatch = text.match(/(?:portfolio|website):\s*(https?:\/\/[^\s]+)/i);
    if (websiteMatch && !profile.website) {
        profile.website = websiteMatch[1];
        updated = true;
    }

    // Extract years of experience
    const expMatch = text.match(/(\d+)\+?\s*years?\s*(?:of\s*)?(?:professional\s*)?experience/i);
    if (expMatch && !qaLibrary.experience) {
        qaLibrary.experience = expMatch[1] + '+ years';
        updated = true;
    }

    // Extract sponsorship
    if (!qaLibrary.sponsorship) {
        if (text.match(/(?:sponsorship|visa).*?(?:no|not needed|don't need|not required)/i)) {
            qaLibrary.sponsorship = 'No';
            updated = true;
        } else if (text.match(/(?:sponsorship|visa).*?(?:yes|need|required)/i)) {
            qaLibrary.sponsorship = 'Yes';
            updated = true;
        }
    }

    // Extract work authorization
    if (text.match(/(?:legally authorized|authorized to work).*?(?:yes|united states)/i) && !qaLibrary.workAuth) {
        qaLibrary.workAuth = 'Yes - United States';
        updated = true;
    }

    // Extract salary
    const salaryMatch = text.match(/\$?\s*(\d{2,3})[kK](?:\s*-\s*\$?\s*(\d{2,3})[kK])?/);
    if (salaryMatch && !qaLibrary.salary) {
        qaLibrary.salary = salaryMatch[0];
        updated = true;
    }

    // Extract start date/availability
    const startMatch = text.match(/(?:start|available).*?(\d+\s*(?:weeks?|months?))/i);
    if (startMatch && !qaLibrary.startDate) {
        qaLibrary.startDate = startMatch[1];
        updated = true;
    }

    // Extract education
    if (text.match(/(?:MS|Master|M\.S\.).*?Computer Science/i) && !profile.education) {
        profile.education = 'MS Computer Science';
        updated = true;
    }

    // Extract gender (if provided)
    const genderMatch = text.match(/(?:gender|identify as):\s*(male|female|non-binary|prefer not to say)/i);
    if (genderMatch && !profile.gender) {
        profile.gender = genderMatch[1];
        updated = true;
    }

    // Extract veteran status
    const veteranMatch = text.match(/(?:veteran status):\s*(yes|no|prefer not to say)/i);
    if (veteranMatch && !profile.veteranStatus) {
        profile.veteranStatus = veteranMatch[1];
        updated = true;
    }

    if (updated) {
        await chrome.storage.local.set({ profile, qaLibrary });
        updateContextDisplay('profileContext', JSON.stringify(profile, null, 2));
        addSystemMessage('✓ Saved your information!');
    }
}

if (clearLogBtn) {
    clearLogBtn.addEventListener('click', () => {
        logMessages.innerHTML = '';
    });
}

async function importProfileTxt({ silent = false } = {}) {
    const statusNode = document.getElementById('profileImportStatus');
    if (importProfileTxtBtn) {
        importProfileTxtBtn.disabled = true;
    }
    if (statusNode) {
        statusNode.textContent = 'Importing profile.txt...';
        statusNode.className = 'resume-status';
    }

    try {
        const response = await fetch('http://localhost:3002/api/import-profile-text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Import failed');
        }

        const state = await getState();
        const mergedProfile = {
            ...(state.profile || {}),
            ...(result.profile || {}),
            importedProfileText: result.profileText || ''
        };
        const mergedQaLibrary = {
            ...(state.qaLibrary || {}),
            ...(result.qaLibrary || {})
        };
        await chrome.storage.local.set({
            profile: mergedProfile,
            qaLibrary: mergedQaLibrary,
            profileTxtAutoImportedAt: new Date().toISOString()
        });

        updateContextDisplay('profileContext', JSON.stringify(mergedProfile, null, 2));
        if (!silent) {
            addSystemMessage('Profile imported from profile.txt and merged into context.');
        }
        if (statusNode) {
            statusNode.textContent = `✓ Imported profile.txt (${result.profileTextLength} chars)`;
            statusNode.className = 'resume-status success';
        }
        return true;
    } catch (error) {
        console.error('Profile import error:', error);
        if (!silent) {
            addSystemMessage(`Profile import failed: ${error.message}`, 'error');
        }
        if (statusNode) {
            statusNode.textContent = `Import failed: ${error.message}`;
            statusNode.className = 'resume-status error';
        }
        return false;
    } finally {
        if (importProfileTxtBtn) {
            importProfileTxtBtn.disabled = false;
        }
    }
}

function shouldAutoImportProfile(profile = {}) {
    if (!profile || Object.keys(profile).length === 0) {
        return true;
    }
    if (!profile.importedProfileText) {
        return true;
    }
    return false;
}

if (importProfileTxtBtn) {
    importProfileTxtBtn.addEventListener('click', async () => {
        await importProfileTxt({ silent: false });
    });
}

// Utility functions
function addUserMessage(text) {
    const div = document.createElement('div');
    div.className = 'message user';
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addAssistantMessage(text) {
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSystemMessage(text, type = 'info') {
    const div = document.createElement('div');
    div.className = 'message system';
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    addLog(text, type);
}

function addLog(text, type = 'info') {
    const div = document.createElement('div');
    div.className = `log-entry ${type}`;
    div.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    logMessages.appendChild(div);
    logMessages.scrollTop = logMessages.scrollHeight;
}

function updateStatus(status) {
    statusBadge.textContent = status;
}

function updateContextDisplay(elementId, content) {
    const node = document.getElementById(elementId);
    if (node) {
        node.textContent = content;
    }
}

async function getState() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getState' }, resolve);
    });
}

async function persistChatHistory() {
    await chrome.storage.local.set({ chatHistory });
}

function renderChatHistory() {
    chatMessages.innerHTML = '';
    for (const entry of chatHistory) {
        if (entry.role === 'user') {
            addUserMessage(entry.content);
        } else if (entry.role === 'assistant') {
            addAssistantMessage(entry.content);
        } else if (entry.role === 'system') {
            addSystemMessage(entry.content);
        }
    }
}

async function loadChatHistory() {
    const stored = await chrome.storage.local.get('chatHistory');
    chatHistory = Array.isArray(stored.chatHistory) ? stored.chatHistory : [];
    renderChatHistory();
}

async function hydrateContextPanels() {
    const state = await getState();
    if (state && state.profile) {
        updateContextDisplay('profileContext', JSON.stringify(state.profile, null, 2));
    }
    if (state?.session?.fields) {
        updateContextDisplay('fieldsContext', JSON.stringify(state.session.fields, null, 2));
    }
    if (state?.session?.lastAnalysis?.requestContext) {
        updateContextDisplay('llmRequestContext', JSON.stringify(state.session.lastAnalysis.requestContext, null, 2));
    }
    if (state?.session?.lastAnalysis?.responseContext) {
        updateContextDisplay('llmResponseContext', JSON.stringify(state.session.lastAnalysis.responseContext, null, 2));
    }
    if (state?.session?.pipeline?.requestContext) {
        updateContextDisplay('pipelineRequestContext', JSON.stringify(state.session.pipeline.requestContext, null, 2));
    }
    if (state?.session?.pipeline?.master) {
        updateContextDisplay('pipelineMasterContext', JSON.stringify(state.session.pipeline.master, null, 2));
    }
    if (Array.isArray(state?.session?.fillPlan)) {
        updateContextDisplay('fillPlanContext', JSON.stringify(state.session.fillPlan, null, 2));
    }

    const stored = await chrome.storage.local.get('resumeFile');
    if (state?.profile?.resumeText) {
        updateContextDisplay('resumeContext', state.profile.resumeText);
    } else if (stored?.resumeFile?.text) {
        updateContextDisplay('resumeContext', stored.resumeFile.text);
    }
}

// Listen for notifications from content script
chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'notifySidePanel') {
        const { data } = message;
        window.__pipelineChatFlags = window.__pipelineChatFlags || { firstError: false, firstFallback: false };

        switch (data.type) {
            case 'fill_started':
                addLog(`Fill started: ${data.mode || 'Full'}`, 'info');
                addSystemMessage(`Fill started: ${data.mode || 'Full'}`);
                break;
            case 'filling':
                addLog(`Filling ${data.field}...`, 'info');
                break;
            case 'filled':
                addLog(`✓ Filled ${data.field}`, 'success');
                break;
            case 'select_fallback':
                addLog(`Select fallback: "${data.requested}" → "${data.chosen}" (${data.field})`, 'warn');
                if (!window.__pipelineChatFlags.firstFallback) {
                    window.__pipelineChatFlags.firstFallback = true;
                    addAssistantMessage(`Select fallback used for ${data.field}:\nRequested: ${data.requested}\nChosen: ${data.chosen}`);
                }
                break;
            case 'element_not_found':
                addLog(`Element not found: ${data.field} (${data.action || ''})`, 'error');
                if (!window.__pipelineChatFlags.firstError) {
                    window.__pipelineChatFlags.firstError = true;
                    addAssistantMessage(`Element not found: ${data.field}\nAction: ${data.action || ''}`);
                }
                break;
            case 'upload_needed':
                addLog(`Upload needed: ${data.field}`, 'warn');
                break;
            case 'error':
                addLog(`✗ Error: ${data.error}`, 'error');
                if (!window.__pipelineChatFlags.firstError) {
                    window.__pipelineChatFlags.firstError = true;
                    addAssistantMessage(`Fill error: ${data.error}`);
                }
                break;
            case 'captcha_detected':
                addSystemMessage('⚠️ CAPTCHA detected! Please solve it and click Resume.');
                updateStatus('CAPTCHA');
                pauseBtn.disabled = true;
                resumeBtn.disabled = false;
                break;
            case 'complete':
                addSystemMessage('✓ Form filling complete!');
                updateStatus('Complete');
                addAssistantMessage('Fill complete.');
                break;
        }
    }
});

// Initialize
(async () => {
    await loadChatHistory();
    const storedProfile = await chrome.storage.local.get('profile');
    if (shouldAutoImportProfile(storedProfile.profile)) {
        await importProfileTxt({ silent: true });
    }
    await hydrateContextPanels();
    addSystemMessage('Jobs AI Assistant ready. Click "Scan Page" to begin.');
})();
