# Jobs AI Chrome Extension

AI-powered job application auto-filler with intelligent field detection and human-like behavior.

## Features

- 🤖 **AI-Powered Form Filling** - GPT-4 analyzes and fills forms intelligently
- 🔍 **Smart Field Detection** - Automatically detects and maps form fields
- 💬 **Interactive Chat** - Ask questions and provide missing information
- ⏸️ **Pause/Resume** - Full control with state persistence
- 🛡️ **Stealth Mode** - Human-like typing with random delays
- 🚨 **CAPTCHA Detection** - Auto-pauses when CAPTCHA appears
- 📝 **Resume Parsing** - Extracts text from PDF resumes
- 📊 **Real-time Logging** - See exactly what's happening

## Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment

Create a `.env` file:

```bash
cp .env.example .env
```

Edit `.env` and add your OpenAI API key:

```
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4o-mini
PORT=3000
```

### 3. Start the Backend Server

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

The server will run on `http://localhost:3000`

### 4. Load Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `JobsAIChromeExt` folder
5. The extension icon should appear in your toolbar

## Usage

### Initial Setup

1. Click the extension icon to open the side panel
2. Go to the **Profile** tab
3. Upload your resume (PDF)
4. Fill in basic information (name, email, phone, etc.)
5. Add quick answers for common questions
6. Click **Save Profile**

### Filling a Form

1. Navigate to a job application page
2. Open the extension side panel
3. Click **Scan Page** - AI will detect all form fields
4. Review the AI's fill plan in the chat
5. Click **Start Filling** - Watch it work!
6. Use **Pause/Resume** as needed
7. If CAPTCHA appears, solve it and click **Resume**

### Chat Commands

The chat interface accepts natural language:

- "What information do you have about me?"
- "Skip the salary field"
- "Use $120k for salary expectation"
- "Pause filling"
- "Continue to next page"

## Architecture

```
┌─────────────────┐
│  Chrome Tab     │
│  (Job Form)     │
└────────┬────────┘
         │
    ┌────▼─────┐
    │ Content  │
    │ Script   │
    └────┬─────┘
         │
    ┌────▼─────────┐
    │  Background  │
    │    Worker    │
    └────┬─────────┘
         │
    ┌────▼─────┐      ┌──────────┐
    │   Side   │      │  Express │
    │  Panel   │◄────►│  Server  │
    └──────────┘      └────┬─────┘
                           │
                      ┌────▼─────┐
                      │  OpenAI  │
                      │   API    │
                      └──────────┘
```

## API Endpoints

### `POST /api/parse-resume`
Upload and parse PDF resume

### `POST /api/analyze-fields`
Analyze form fields and generate fill plan

### `POST /api/chat`
Chat with AI assistant

### `GET /api/session/:sessionId`
Get session state

### `PATCH /api/session/:sessionId`
Update session state

## Configuration

### Settings (in side panel)

- **Auto-continue to next page** - Automatically proceed after filling
- **Auto-submit** - Automatically submit forms (use with caution!)

### Delays (in code)

Edit `content/content-script.js`:

```javascript
await randomDelay(50, 150);  // Typing delay per character
await randomDelay(300, 800); // Delay between fields
```

## Security & Privacy

- All data stored locally in Chrome storage
- Resume text cached after parsing (no re-upload needed)
- API key never sent to browser
- No external tracking or analytics

## Troubleshooting

### Extension not loading
- Check Chrome version (requires Manifest V3 support)
- Ensure all files are present
- Check browser console for errors

### Server not connecting
- Verify server is running on port 3000
- Check `.env` file has valid API key
- Look for CORS errors in console

### Fields not filling
- Check if page uses shadow DOM (not supported yet)
- Verify field detection in console logs
- Try manual pause/resume

### CAPTCHA issues
- Extension auto-pauses when detected
- Solve manually and click Resume
- Some CAPTCHAs may still block automation

## Development

### File Structure

```
JobsAIChromeExt/
├── manifest.json           # Extension config
├── background/
│   └── service-worker.js   # State management
├── content/
│   └── content-script.js   # Form interaction
├── sidepanel/
│   ├── sidepanel.html      # UI
│   ├── sidepanel.css       # Styles
│   └── sidepanel.js        # UI logic
├── server/
│   └── index.js            # Express + OpenAI
└── icons/                  # Extension icons
```

### Adding New Features

1. **New field type**: Edit `fillField()` in `content-script.js`
2. **New AI prompt**: Edit system prompt in `server/index.js`
3. **New UI element**: Add to `sidepanel.html` and wire in `sidepanel.js`

## Limitations

- Only works on standard HTML forms
- Shadow DOM not fully supported
- Some ATS systems may have custom widgets
- File uploads require manual intervention
- CAPTCHA must be solved manually

## Roadmap

- [ ] Multi-page session tracking
- [ ] Custom field mappings
- [ ] ATS-specific templates
- [ ] Cloud sync for profiles
- [ ] Firefox support
- [ ] Advanced anti-detection

## License

MIT

## Support

For issues or questions, open an issue on GitHub.
