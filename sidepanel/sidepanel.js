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
    addSystemMessage('Scanning page for form fields...');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.tabs.sendMessage(tab.id, { action: 'scanPage' }, async (response) => {
        if (response && response.success) {
            currentFields = response.fields;
            addSystemMessage(`Found ${response.fields.length} fields`);
            updateContextDisplay('fieldsContext', JSON.stringify(response.fields, null, 2));

            // Send to AI for analysis
            await analyzeFields(response.fields);
        } else {
            addSystemMessage('Error scanning page', 'error');
            updateStatus('Error');
        }
    });
});

// Analyze fields with AI
async function analyzeFields(fields) {
    addSystemMessage('Analyzing fields with AI...');

    const response = await chrome.runtime.sendMessage({
        action: 'analyzeFields',
        data: { fields }
    });

    if (response && response.success) {
        addSystemMessage(`AI generated fill plan for ${response.fillPlan.length} fields`);

        if (response.missingInfo && response.missingInfo.length > 0) {
            addAssistantMessage(`I need some information:\n${response.missingInfo.join('\n')}`);
        }

        if (response.warnings && response.warnings.length > 0) {
            addSystemMessage(`Warnings: ${response.warnings.join(', ')}`);
        }

        fillBtn.disabled = false;
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

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.tabs.sendMessage(tab.id, {
        action: 'startFilling',
        data: {
            fillPlan: state.session.fillPlan,
            fields: currentFields  // Pass field metadata for lookup
        }
    }, (response) => {
        if (response && response.success) {
            addSystemMessage('Filling complete!');
            updateStatus('Complete');
        } else {
            addSystemMessage('Filling encountered errors', 'error');
            updateStatus('Error');
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

    // Extract user information from message
    await extractAndSaveUserInfo(message);

    const response = await chrome.runtime.sendMessage({
        action: 'chat',
        data: { message, history: chatHistory }
    });

    if (response && response.success) {
        addAssistantMessage(response.response);
        chatHistory.push(
            { role: 'user', content: message },
            { role: 'assistant', content: response.response }
        );

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

// Profile management
document.getElementById('parseResumeBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('resumeUpload');
    const file = fileInput.files[0];

    if (!file) {
        addSystemMessage('Please select a PDF file', 'error');
        return;
    }

    addSystemMessage('Parsing resume...');

    try {
        // Create FormData and send directly to API
        const formData = new FormData();
        formData.append('resume', file);

        const response = await fetch('http://localhost:3002/api/parse-resume', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.success) {
            // Save to storage
            const state = await getState();
            const profile = state.profile || {};
            profile.resumeText = result.resumeText;
            profile.resumeMetadata = result.metadata;

            await chrome.storage.local.set({ profile });

            addSystemMessage('✓ Resume parsed successfully!');
            updateContextDisplay('resumeContext', result.resumeText.substring(0, 500) + '...');
        } else {
            throw new Error(result.error || 'Parse failed');
        }
    } catch (error) {
        console.error('Resume parse error:', error);
        addSystemMessage(`Resume parsing failed: ${error.message}`, 'error');
    }
});

document.getElementById('saveProfileBtn').addEventListener('click', async () => {
    const profile = {
        name: document.getElementById('nameInput').value,
        email: document.getElementById('emailInput').value,
        phone: document.getElementById('phoneInput').value,
        location: document.getElementById('locationInput').value
    };

    const qaLibrary = {
        sponsorship: document.getElementById('sponsorshipInput').value,
        startDate: document.getElementById('startDateInput').value,
        salary: document.getElementById('salaryInput').value
    };

    await chrome.storage.local.set({ profile, qaLibrary });
    addSystemMessage('Profile saved!');
    updateContextDisplay('profileContext', JSON.stringify(profile, null, 2));
});

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
    document.getElementById(elementId).textContent = content;
}

async function getState() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getState' }, resolve);
    });
}

// Listen for notifications from content script
chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'notifySidePanel') {
        const { data } = message;

        switch (data.type) {
            case 'filling':
                addLog(`Filling ${data.field}...`, 'info');
                break;
            case 'filled':
                addLog(`✓ Filled ${data.field}`, 'success');
                break;
            case 'error':
                addLog(`✗ Error: ${data.error}`, 'error');
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
                break;
        }
    }
});

// Initialize
(async () => {
    const state = await getState();
    if (state && state.profile) {
        updateContextDisplay('profileContext', JSON.stringify(state.profile, null, 2));
    }

    addSystemMessage('Jobs AI Assistant ready. Click "Scan Page" to begin.');
})();
