# Architecture & Technical Details

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Chrome Browser                          │
│                                                             │
│  ┌──────────────┐         ┌─────────────────┐             │
│  │  Job Form    │◄────────┤  Content Script │             │
│  │  (Active Tab)│         │  - DOM Scanner  │             │
│  └──────────────┘         │  - Form Filler  │             │
│                           │  - CAPTCHA Det. │             │
│                           └────────┬────────┘             │
│                                    │                       │
│                           ┌────────▼────────┐             │
│                           │ Service Worker  │             │
│                           │  - State Mgmt   │             │
│                           │  - API Client   │             │
│                           │  - Storage      │             │
│                           └────────┬────────┘             │
│                                    │                       │
│  ┌─────────────┐         ┌────────▼────────┐             │
│  │ Side Panel  │◄────────┤  Message Bus    │             │
│  │  - Chat UI  │         └─────────────────┘             │
│  │  - Controls │                                          │
│  │  - Logs     │                                          │
│  └─────────────┘                                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP/REST
                              │
┌─────────────────────────────▼─────────────────────────────┐
│                    Express Server (Port 3002)              │
│                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐    │
│  │ Resume Parser│  │ Field Analyzer│  │ Chat Engine │    │
│  │  (pdf-parse) │  │   (OpenAI)    │  │  (OpenAI)   │    │
│  └──────────────┘  └──────────────┘  └─────────────┘    │
│                                                            │
│  ┌──────────────────────────────────────────────────┐    │
│  │          Session Manager (In-Memory)              │    │
│  └──────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ API Calls
                              │
                    ┌─────────▼──────────┐
                    │   OpenAI API       │
                    │  (gpt-4o-mini)     │
                    └────────────────────┘
```

## Component Details

### 1. Content Script (`content/content-script.js`)

**Purpose**: Injected into every page, handles DOM interaction

**Key Functions**:
- `detectFormFields()` - Scans page for input elements
- `executeFillPlan()` - Fills fields according to AI plan
- `humanLikeType()` - Simulates human typing
- `detectCaptchaSync()` - Monitors for CAPTCHA

**Stealth Features**:
- Random delays (50-150ms per character)
- Natural scrolling behavior
- Focus/blur events
- Progressive value setting
- Event dispatching (input, change)

**CAPTCHA Detection**:
```javascript
const captchaSelectors = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  '.g-recaptcha',
  '.h-captcha'
];
```

### 2. Service Worker (`background/service-worker.js`)

**Purpose**: Background process managing state and API communication

**Key Responsibilities**:
- Chrome storage management
- API request orchestration
- Message routing between components
- Session state persistence

**Storage Schema**:
```javascript
{
  profile: {
    name, email, phone, location,
    resumeText, resumeMetadata
  },
  qaLibrary: {
    sponsorship, startDate, salary
  },
  session: {
    status, currentUrl, fillPlan,
    completedFields, pendingFields, failedFields
  },
  history: [
    { timestamp, url, action, field, value }
  ],
  settings: {
    autoContinue, autoSubmit, humanDelay
  }
}
```

### 3. Side Panel (`sidepanel/`)

**Purpose**: User interface for control and monitoring

**Tabs**:
1. **Chat** - Interactive AI conversation
2. **Context** - View all data (profile, resume, fields)
3. **Log** - Real-time action logging
4. **Profile** - Setup and configuration

**Controls**:
- Scan Page
- Start Filling
- Pause/Resume
- Settings toggles

### 4. Express Server (`server/index.js`)

**Purpose**: Backend API for AI processing

**Endpoints**:

#### `POST /api/parse-resume`
```javascript
// Input: multipart/form-data with PDF file
// Output: { resumeText, metadata }
// Uses: pdf-parse library
```

#### `POST /api/analyze-fields`
```javascript
// Input: { fields, userContext, sessionId }
// Output: { fillPlan, missingInfo, warnings }
// Process:
//   1. Build comprehensive prompt
//   2. Call OpenAI with JSON mode
//   3. Parse and validate response
//   4. Store in session
```

#### `POST /api/chat`
```javascript
// Input: { message, context, history }
// Output: { response, timestamp }
// Uses: OpenAI chat completions
```

## Data Flow

### Scanning Flow
```
User clicks "Scan Page"
  ↓
Side Panel → Content Script: scanPage
  ↓
Content Script: detectFormFields()
  ↓
Content Script → Side Panel: { fields }
  ↓
Side Panel → Service Worker: analyzeFields
  ↓
Service Worker → Server: POST /api/analyze-fields
  ↓
Server → OpenAI: Analyze with context
  ↓
OpenAI → Server: Fill plan JSON
  ↓
Server → Service Worker: { fillPlan, missingInfo }
  ↓
Service Worker → Chrome Storage: Save session
  ↓
Service Worker → Side Panel: Success
  ↓
Side Panel: Enable "Start Filling" button
```

### Filling Flow
```
User clicks "Start Filling"
  ↓
Side Panel → Content Script: startFilling
  ↓
Content Script: executeFillPlan()
  ↓
For each field:
  - Check pause state
  - Check for CAPTCHA
  - Scroll to element
  - Fill with human-like behavior
  - Log action
  - Random delay
  ↓
Content Script → Side Panel: Progress updates
  ↓
Side Panel: Update UI and logs
```

## AI Prompting Strategy

### System Prompt (Field Analysis)
```
You are an intelligent form-filling assistant.

RULES:
1. For text inputs: Provide exact text
2. For dropdowns: Choose ONE option from list
3. For radio: Select ONE from group
4. For checkboxes: Return boolean
5. NEVER make up data
6. If confidence < 0.7, mark as needs_user_input

Return JSON:
{
  fillPlan: [
    { fieldId, action, value, confidence, reasoning }
  ],
  missingInfo: ["questions"],
  warnings: ["concerns"]
}
```

### Context Building
```javascript
const context = {
  user_info_text: "Name: John...",
  user_info_resume: "Full resume text...",
  user_info_past_saved: "Previous answers...",
  form_fields: [
    {
      id: "email",
      label: "Email Address",
      type: "text",
      required: true,
      options: [] // For select/radio
    }
  ]
};
```

## Security Considerations

### Data Privacy
- All user data stored locally in Chrome storage
- Resume text cached (no re-upload)
- API key never exposed to browser
- No external analytics or tracking

### API Security
- CORS enabled for localhost only
- No authentication (local use only)
- File upload size limited to 10MB
- Uploaded files deleted after parsing

### Extension Permissions
```json
{
  "permissions": [
    "storage",      // Chrome local storage
    "activeTab",    // Current tab access
    "scripting",    // Content script injection
    "sidePanel"     // Side panel API
  ],
  "host_permissions": [
    "<all_urls>"    // Required for form filling
  ]
}
```

## Performance Optimizations

### Content Script
- Lazy field detection (only on scan)
- Efficient DOM queries
- Minimal memory footprint
- Event delegation

### Service Worker
- In-memory session cache
- Debounced storage writes
- Async message handling
- Automatic cleanup

### Server
- In-memory session storage (Map)
- Streaming responses (future)
- Connection pooling
- File cleanup after parsing

## Error Handling

### Content Script
```javascript
try {
  await fillField(item);
  logAction({ success: true });
} catch (error) {
  logAction({ success: false, error: error.message });
  notifySidePanel({ type: 'error', field, error });
  // Continue to next field
}
```

### Service Worker
```javascript
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    // Handle message
    sendResponse({ success: true, data });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
  return true; // Keep channel open
});
```

### Server
```javascript
app.post('/api/endpoint', async (req, res) => {
  try {
    // Process request
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: 'Friendly message',
      details: error.message 
    });
  }
});
```

## Testing Strategy

### Manual Testing
1. Test on multiple ATS platforms
2. Verify CAPTCHA detection
3. Test pause/resume
4. Verify data persistence
5. Test error recovery

### Browser Console Testing
```javascript
// Check storage
chrome.storage.local.get(null, console.log);

// Send test message
chrome.runtime.sendMessage({ action: 'getState' }, console.log);

// Check session
fetch('http://localhost:3002/api/health').then(r => r.json()).then(console.log);
```

## Future Enhancements

### Phase 2
- [ ] Multi-page session tracking
- [ ] Custom field mappings
- [ ] Template library for common ATSs
- [ ] Cloud sync for profiles
- [ ] Advanced stealth (mouse movements)

### Phase 3
- [ ] Firefox support
- [ ] Mobile browser support
- [ ] Team collaboration features
- [ ] Analytics dashboard
- [ ] A/B testing for success rates

## Debugging Tips

### Extension Issues
```bash
# Check extension console
chrome://extensions/ → Details → Inspect views: service worker

# Check content script
Right-click page → Inspect → Console (filter by content-script.js)

# Check side panel
Open side panel → Right-click → Inspect
```

### Server Issues
```bash
# Check server logs
# Terminal where npm start is running

# Test endpoints
curl http://localhost:3002/health

# Check OpenAI connection
# Look for API key validation in startup logs
```

### Storage Issues
```javascript
// Clear all storage
chrome.storage.local.clear();

// View specific keys
chrome.storage.local.get(['profile', 'session'], console.log);
```

## Performance Metrics

### Expected Performance
- Page scan: < 1 second
- AI analysis: 2-5 seconds
- Field filling: 5-30 seconds (depends on form size)
- Resume parsing: 1-3 seconds

### Resource Usage
- Memory: ~50MB (extension + server)
- CPU: Minimal (spikes during AI calls)
- Network: ~1-5KB per API call
- Storage: ~1-5MB (profile + history)
