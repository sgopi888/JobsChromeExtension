// Background service worker - manages state and coordinates between content script and server

const API_BASE = 'http://localhost:3002/api';
const PIPELINE_API_BASE = 'http://127.0.0.1:8877';

function emitUiLog(level, message, { location = 'pipeline', type = 'regular' } = {}) {
    const payload = {
        level,
        message,
        timestamp: new Date().toISOString(),
        location,
        type
    };

    chrome.runtime.sendMessage({
        action: 'displayLog',
        data: payload
    }).catch(() => {});
}

function pipelineLog(stage, message, data = null, level = 'info') {
    const line = `[${stage}] ${message}`;
    emitUiLog(level, line, { location: 'pipeline', type: 'regular' });

    if (data !== null && data !== undefined) {
        const detailed = JSON.stringify({ stage, message, data }, null, 2);
        emitUiLog(level, detailed, { location: 'pipeline', type: 'detailed' });
    }
}

function toFillPlanFromPipelineMaster(pipelineMaster) {
    const filledFields = Array.isArray(pipelineMaster?.filled_fields) ? pipelineMaster.filled_fields : [];

    const typeFieldTypes = new Set(['text', 'textarea', 'tel', 'email', 'url', 'number', 'date', 'richtext']);
    const plan = [];
    const seen = new Set();

    let typeCount = 0;
    let selectCount = 0;
    let uploadCount = 0;
    let ignoredCount = 0;
    let checkCount = 0;

    for (const field of filledFields) {
        const fieldId = String(field?.id || '').trim();
        const fieldType = String(field?.field_type || '').trim().toLowerCase();
        const value = field?.value;

        if (!fieldId) {
            ignoredCount += 1;
            continue;
        }

        const isEmptyString = typeof value === 'string' && value.trim() === '';
        const isEmptyArray = Array.isArray(value) && value.length === 0;
        if (isEmptyString || isEmptyArray || value === null || value === undefined) {
            ignoredCount += 1;
            continue;
        }

        if (typeFieldTypes.has(fieldType)) {
            const item = {
                fieldId,
                action: 'type',
                value: typeof value === 'string' ? value : String(value ?? '')
            };
            const key = `${item.fieldId}|${item.action}|${item.value}`;
            if (!seen.has(key)) {
                seen.add(key);
                plan.push(item);
                typeCount += 1;
            }
            continue;
        }

        if (fieldType === 'select') {
            const isMulti = Array.isArray(value);
            const values = isMulti ? value : [value];
            for (const entry of values) {
                const entryValue = typeof entry === 'string' ? entry : String(entry ?? '');
                if (!entryValue) continue;
                const item = {
                    fieldId,
                    action: 'select',
                    value: entryValue,
                    multi: isMulti
                };
                const key = `${item.fieldId}|${item.action}|${item.value}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    plan.push(item);
                    selectCount += 1;
                }
            }
            continue;
        }

        if (fieldType === 'file') {
            const item = {
                fieldId,
                action: 'upload',
                value: ''
            };
            const key = `${item.fieldId}|${item.action}|${item.value}`;
            if (!seen.has(key)) {
                seen.add(key);
                plan.push(item);
                uploadCount += 1;
            }
            continue;
        }

        if (fieldType === 'checkbox_group') {
            const item = {
                fieldId,
                action: 'check',
                value: true
            };
            const key = `${item.fieldId}|${item.action}|${item.value}`;
            if (!seen.has(key)) {
                seen.add(key);
                plan.push(item);
                checkCount += 1;
            }
            continue;
        }

        ignoredCount += 1;
    }

    return {
        fillPlan: plan,
        counts: { typeCount, selectCount, uploadCount, checkCount, ignoredCount, total: plan.length }
    };
}

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
        chatHistory: [],
        session: {
            status: 'idle',
            currentUrl: '',
            fillPlan: [],
            fields: [],
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
        case 'pipelineScan':
            handlePipelineScan(message.data, sendResponse);
            return true;

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

        case 'logToUI':
            // Log relay: Forward logs from content script to sidepanel
            chrome.runtime.sendMessage({
                action: 'displayLog',
                data: message.data
            }).catch(() => {
                // Sidepanel not open, ignore silently
            });
            sendResponse({ success: true });
            return false;

        default:
            sendResponse({ error: 'Unknown action' });
    }
});

async function handlePipelineScan(data, sendResponse) {
    const url = String(data?.url || '').trim();
    if (!url) {
        pipelineLog('error', "Missing 'url' for pipeline scan.", { data }, 'error');
        sendResponse({ success: false, error: "Missing 'url'" });
        return;
    }

    const requestContext = {
        url,
        startedAt: new Date().toISOString(),
        pipelineEndpoint: `${PIPELINE_API_BASE}/pipeline`,
        activeTabUrl: url,
        scanFieldCount: typeof data?.scanFieldCount === 'number' ? data.scanFieldCount : undefined,
        pageTitle: data?.pageTitle || undefined
    };

    pipelineLog('pipeline_request', 'Calling Python pipeline.', requestContext, 'info');

    try {
        const response = await fetch(`${PIPELINE_API_BASE}/pipeline`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });

        const rawText = await response.text();
        if (!response.ok) {
            pipelineLog('error', `Pipeline error HTTP ${response.status}.`, { status: response.status, body: rawText }, 'error');
            sendResponse({ success: false, error: rawText || `Pipeline error: ${response.status}` });
            return;
        }

        let pipelineMaster;
        try {
            pipelineMaster = JSON.parse(rawText);
        } catch (parseError) {
            pipelineLog('error', 'Pipeline returned non-JSON response.', { rawText }, 'error');
            sendResponse({ success: false, error: 'Pipeline returned invalid JSON.' });
            return;
        }

        const filledCount = Array.isArray(pipelineMaster?.filled_fields) ? pipelineMaster.filled_fields.length : 0;
        pipelineLog('pipeline_response', `Pipeline response received (${filledCount} filled_fields).`, pipelineMaster, 'info');

        const { fillPlan, counts } = toFillPlanFromPipelineMaster(pipelineMaster);
        pipelineLog('convert_fillplan', 'Converted master JSON to fillPlan.', counts, 'info');

        const stored = await chrome.storage.local.get(['session']);
        const activeSession = stored.session || { sessionId: generateSessionId() };
        await chrome.storage.local.set({
            session: {
                ...activeSession,
                status: 'ready',
                currentUrl: url,
                pipeline: {
                    requestContext,
                    master: pipelineMaster,
                    counts,
                    convertedAt: new Date().toISOString()
                },
                fillPlan
            }
        });

        sendResponse({
            success: true,
            requestContext,
            pipelineMaster,
            fillPlan,
            counts
        });
    } catch (error) {
        pipelineLog('error', 'Pipeline request failed.', { message: error?.message || String(error) }, 'error');
        sendResponse({ success: false, error: error?.message || String(error) });
    }
}

// Analyze form fields with AI
async function handleAnalyzeFields(data, sendResponse) {
    try {
        const { fields } = data;
        const stored = await chrome.storage.local.get(['profile', 'qaLibrary', 'session', 'resumeFile', 'chatHistory']);
        const activeSession = stored.session || { sessionId: generateSessionId() };
        const resumeText = stored?.profile?.resumeText || stored?.resumeFile?.text || '';
        const recentChat = Array.isArray(stored.chatHistory) ? stored.chatHistory.slice(-20) : [];

        const userContext = {
            profile: stored.profile,
            qaLibrary: stored.qaLibrary,
            resumeText,
            chatHistory: recentChat
        };

        const requestContext = {
            title: 'LLM REQUEST CONTEXT',
            fieldsCount: fields.length,
            fieldTypes: fields.reduce((acc, f) => {
                acc[f.type] = (acc[f.type] || 0) + 1;
                return acc;
            }, {}),
            profile: userContext.profile || {},
            qaLibrary: userContext.qaLibrary || {},
            resumeLength: userContext.resumeText?.length || 0,
            chatHistoryLength: recentChat.length,
            chatHistoryPreview: recentChat.slice(-6),
            sessionId: activeSession.sessionId
        };

        // Log full LLM request context
        chrome.runtime.sendMessage({
            action: 'displayLog',
            data: {
                level: 'info',
                message: JSON.stringify(requestContext, null, 2),
                timestamp: new Date().toISOString(),
                location: 'service-worker',
                type: 'detailed'
            }
        }).catch(() => {});

        const response = await fetch(`${API_BASE}/analyze-fields`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fields,
                userContext,
                sessionId: activeSession.sessionId
            })
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.statusText}`);
        }

        const result = await response.json();
        const responseContext = {
            title: 'LLM RESPONSE (COMPLETE - NO TRUNCATION)',
            fillPlan: result.fillPlan || [],
            fillPlanCount: result.fillPlan?.length || 0,
            missingInfo: result.missingInfo || [],
            warnings: result.warnings || [],
            responseFields: Object.keys(result)
        };

        // Log full LLM response (no truncation)
        chrome.runtime.sendMessage({
            action: 'displayLog',
            data: {
                level: 'info',
                message: JSON.stringify(responseContext, null, 2),
                timestamp: new Date().toISOString(),
                location: 'service-worker',
                type: 'detailed'
            }
        }).catch(() => {});

        // Update session with fill plan
        await chrome.storage.local.set({
            session: {
                ...activeSession,
                fillPlan: result.fillPlan || [],
                fields,
                status: 'ready',
                lastAnalysis: {
                    requestContext,
                    responseContext,
                    analyzedAt: new Date().toISOString()
                }
            }
        });

        sendResponse({
            success: true,
            ...result,
            debug: {
                requestContext,
                responseContext
            }
        });
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
        const state = await chrome.storage.local.get(['profile', 'qaLibrary', 'chatHistory', 'session', 'history', 'settings']);
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
