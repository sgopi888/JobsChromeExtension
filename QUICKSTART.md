# Quick Start Guide

## ✅ Server is Running!

Your Jobs AI backend server is now running on **http://localhost:3002**

## Next Steps

### 1. Load the Extension in Chrome

1. Open Chrome browser
2. Go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Navigate to and select: `/Users/sreekanthgopi/Desktop/Apps/JobsAIChromeExt`
6. The extension should now appear in your toolbar

### 2. Set Up Your Profile

1. Click the extension icon in Chrome toolbar
2. The side panel will open on the right
3. Go to the **Profile** tab
4. Upload your resume (PDF format)
5. Click **Parse Resume** - AI will extract the text
6. Fill in your basic info:
   - Full Name
   - Email
   - Phone
   - Location
7. Add quick answers for common questions:
   - Sponsorship needs
   - Available start date
   - Salary expectations
8. Click **Save Profile**

### 3. Fill Your First Form

1. Navigate to any job application page (e.g., Greenhouse, Lever, Workday)
2. Open the extension side panel (click the icon)
3. Click **Scan Page** - AI will detect all form fields
4. Review what the AI found in the **Context** tab
5. Click **Start Filling** - Watch the magic happen!
6. Use **Pause** if you need to stop
7. Use **Resume** to continue

### 4. Chat with the AI

The chat interface lets you:
- Ask what information the AI has about you
- Provide missing information on the fly
- Override specific field values
- Control the filling process

Example commands:
```
"What do you know about me?"
"Use $150k for salary expectation"
"Skip the cover letter field"
"Pause"
```

## Important Notes

### CAPTCHA Handling
- The extension automatically detects CAPTCHAs
- It will **auto-pause** when a CAPTCHA appears
- Solve the CAPTCHA manually
- Click **Resume** to continue

### Stealth Features
- Human-like typing with random delays (50-150ms per character)
- Random delays between fields (300-800ms)
- Natural scrolling and focus behavior
- No automation signatures that trigger bot detection

### Settings
- **Auto-continue to next page**: Automatically proceeds after filling (requires approval)
- **Auto-submit**: Automatically submits forms (⚠️ use with caution!)

## Troubleshooting

### Extension not appearing
- Make sure you selected the correct folder
- Check for errors in `chrome://extensions/`
- Reload the extension

### Server connection errors
- Verify server is running (check terminal)
- Confirm it's on port 3002
- Check browser console for CORS errors

### Fields not filling
- Some sites use shadow DOM (not supported yet)
- Try scanning the page again
- Check the log tab for errors

## File Locations

- **Extension folder**: `/Users/sreekanthgopi/Desktop/Apps/JobsAIChromeExt`
- **Server**: Running on port 3002
- **Logs**: Check the Log tab in side panel
- **Storage**: Chrome's local storage (inspect in DevTools)

## Testing Suggestions

Good sites to test on:
- Greenhouse.io applications
- Lever.co applications
- LinkedIn Easy Apply
- Indeed applications
- Company career pages

## Need Help?

Check the logs:
1. **Extension logs**: Open side panel → Log tab
2. **Server logs**: Check your terminal
3. **Browser console**: Right-click → Inspect → Console

---

**🎉 You're all set! Go fill some applications!**
