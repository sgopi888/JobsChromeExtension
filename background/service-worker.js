// Background service worker - manages state and coordinates between content script and server

const API_BASE = 'http://localhost:3002/api';

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
    console.log('Jobs AI Extension installed');
    initializeStorage();
});

// Initialize storage with default values
async function initializeStorage() {
    const defaults = {
        profile: {},
        qaLibrary: {},
        session: {
            status: 'idle',
            currentUrl: '',
            fillPlan: [],
            completedFields: [],
            pendingFields: [],
            failedFields: [],
            sessionId: generateSessionId()
        },
        history: [],
        settings: {
            autoContinue: false,
            autoSubmit: false,
            humanDelay: true,
            minDelay: 50,
            maxDelay: 150
        }
    };

    const stored = await chrome.storage.local.get(Object.keys(defaults));

    // Only set defaults for missing keys
    for (const [key, value] of Object.entries(defaults)) {
        if (!stored[key]) {
            await chrome.storage.local.set({ [key]: value });
        }
    }
}

// Generate unique session ID
function generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Background received message:', message.action);

    switch (message.action) {
        case 'analyzeFields':
            handleAnalyzeFields(message.data, sendResponse);
            return true; // Keep channel open for async response

        case 'updateSession':
            handleUpdateSession(message.data, sendResponse);
            return true;

        case 'chat':
            handleChat(message.data, sendResponse);
            return true;

        case 'getState':
            handleGetState(sendResponse);
            return true;

        case 'parseResume':
            handleParseResume(message.data, sendResponse);
            return true;

        case 'pauseFilling':
            handlePause(sendResponse);
            return true;

        case 'resumeFilling':
            handleResume(sendResponse);
            return true;

        case 'logAction':
            handleLogAction(message.data, sendResponse);
            return true;

        default:
            sendResponse({ error: 'Unknown action' });
    }
});

// Analyze form fields with AI
async function handleAnalyzeFields(data, sendResponse) {
    try {
        const { fields } = data;
        const stored = await chrome.storage.local.get(['profile', 'qaLibrary', 'session']);

        const userContext = {
            profile: stored.profile,
            qaLibrary: stored.qaLibrary,
            resumeText: stored.profile.resumeText || ''
        };

        const response = await fetch(`${API_BASE}/analyze-fields`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fields,
                userContext,
                sessionId: stored.session.sessionId
            })
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.statusText}`);
        }

        const result = await response.json();

        // Update session with fill plan
        await chrome.storage.local.set({
            session: {
                ...stored.session,
                fillPlan: result.fillPlan,
                status: 'ready'
            }
        });

        sendResponse({ success: true, ...result });
    } catch (error) {
        console.error('Analyze fields error:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Handle chat messages
async function handleChat(data, sendResponse) {
    try {
        const { message, history } = data;
        const stored = await chrome.storage.local.get(['profile', 'session']);

        const response = await fetch(`${API_BASE}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                context: {
                    profile: stored.profile,
                    sessionStatus: stored.session.status
                },
                history
            })
        });

        if (!response.ok) {
            throw new Error(`Chat API error: ${response.statusText}`);
        }

        const result = await response.json();
        sendResponse({ success: true, ...result });
    } catch (error) {
        console.error('Chat error:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Parse resume
async function handleParseResume(data, sendResponse) {
    try {
        const { file } = data;

        const formData = new FormData();
        formData.append('resume', file);

        const response = await fetch(`${API_BASE}/parse-resume`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Parse error: ${response.statusText}`);
        }

        const result = await response.json();

        // Store resume text and metadata
        const stored = await chrome.storage.local.get('profile');
        await chrome.storage.local.set({
            profile: {
                ...stored.profile,
                resumeText: result.resumeText,
                resumeMetadata: result.metadata
            }
        });

        sendResponse({ success: true, ...result });
    } catch (error) {
        console.error('Resume parse error:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Update session state
async function handleUpdateSession(data, sendResponse) {
    try {
        const stored = await chrome.storage.local.get('session');
        const updated = { ...stored.session, ...data };
        await chrome.storage.local.set({ session: updated });
        sendResponse({ success: true, session: updated });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

// Get current state
async function handleGetState(sendResponse) {
    try {
        const state = await chrome.storage.local.get(['profile', 'session', 'history', 'settings']);
        sendResponse({ success: true, ...state });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

// Pause filling
async function handlePause(sendResponse) {
    try {
        const stored = await chrome.storage.local.get('session');
        await chrome.storage.local.set({
            session: { ...stored.session, status: 'paused' }
        });

        // Notify content script
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            chrome.tabs.sendMessage(tab.id, { action: 'pause' });
        }

        sendResponse({ success: true });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

// Resume filling
async function handleResume(sendResponse) {
    try {
        const stored = await chrome.storage.local.get('session');
        await chrome.storage.local.set({
            session: { ...stored.session, status: 'filling' }
        });

        // Notify content script
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            chrome.tabs.sendMessage(tab.id, { action: 'resume' });
        }

        sendResponse({ success: true });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

// Log action to history
async function handleLogAction(data, sendResponse) {
    try {
        const stored = await chrome.storage.local.get('history');
        const history = stored.history || [];

        history.push({
            ...data,
            timestamp: new Date().toISOString()
        });

        // Keep last 1000 entries
        if (history.length > 1000) {
            history.shift();
        }

        await chrome.storage.local.set({ history });
        sendResponse({ success: true });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
    await chrome.sidePanel.open({ windowId: tab.windowId });
});
