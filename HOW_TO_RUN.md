# 🚀 How to Run Jobs AI Extension

## Terminal 1: Start the Backend Server

```bash
cd /Users/sreekanthgopi/Desktop/Apps/JobsAIChromeExt
npm start
```

**OR** use the startup script:
```bash
./start.sh
```

You should see:
```
🚀 Jobs AI Server running on http://localhost:3002
📝 Model: gpt-4o-mini
🔑 API Key: ✓ Configured
```

**Keep this terminal open!** The server must run continuously.

---

## Browser: Load the Extension

1. Open Chrome
2. Go to: `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select folder: `/Users/sreekanthgopi/Desktop/Apps/JobsAIChromeExt`
6. Extension icon appears in toolbar ✅

---

## Using the Extension

### Step 1: Set Up Profile (One-time)

1. Click extension icon → Side panel opens
2. Go to **Profile** tab
3. **Upload Resume**:
   - Click "Choose File"
   - Select your PDF resume
   - Click "Parse Resume"
   - Wait for "✓ Resume parsed successfully!"

4. **Fill Basic Info** (or use chat):
   - Name
   - Email
   - Phone
   - Location

5. **Add Quick Answers**:
   - Sponsorship needs
   - Start date
   - Salary expectations

6. Click **Save Profile**

### Step 2: Use Chat to Add Info (Easier!)

Instead of filling forms, just chat with the AI:

```
"My name is Sreekanth Gopi, email sreekanthgopi@example.com, 
phone +1-234-567-8900. I'm located in San Francisco, CA. 
I don't need sponsorship. My salary expectation is $120k-$150k. 
I can start in 2 weeks."
```

The extension will **automatically extract and save** this information!

### Step 3: Fill a Job Application

1. Navigate to any job application page
2. Open extension side panel (click icon)
3. Click **"Scan Page"**
   - AI detects all form fields
   - Generates fill plan
   - Shows what info is missing

4. If AI asks for info, provide it via chat:
   ```
   "My LinkedIn is linkedin.com/in/sreekanthgopi"
   "My GitHub is github.com/sreekanthgopi"
   ```

5. Click **"Start Filling"**
   - Watch it fill fields automatically
   - See real-time logs
   - Use Pause/Resume as needed

6. **Review and Submit** manually

---

## Monitoring

### View Logs
- Side panel → **Log tab**
- See every action in real-time
- Color-coded: success (green), error (red), info (blue)

### View Context
- Side panel → **Context tab**
- See all data AI has:
  - Your profile
  - Resume text
  - Detected fields

### Server Logs
- Check Terminal 1 where server is running
- See API calls and responses

---

## Troubleshooting

### Server won't start (port in use)
```bash
# Kill process on port 3002
lsof -ti:3002 | xargs kill -9

# Then restart
npm start
```

### Extension not loading
1. Go to `chrome://extensions/`
2. Click "Reload" on Jobs AI extension
3. Check for errors

### Resume parsing fails
- Make sure server is running
- Check file is PDF format
- Check server logs for errors

### Fields not filling
- Click "Scan Page" first
- Check Log tab for errors
- Try Pause/Resume

### CAPTCHA appears
- Extension auto-pauses
- Solve CAPTCHA manually
- Click "Resume"

---

## Quick Commands

### Start server:
```bash
cd /Users/sreekanthgopi/Desktop/Apps/JobsAIChromeExt && npm start
```

### Kill server:
```bash
lsof -ti:3002 | xargs kill -9
```

### Reload extension:
1. `chrome://extensions/`
2. Click reload icon on Jobs AI

### Clear extension data:
```javascript
// In browser console (F12)
chrome.storage.local.clear()
```

---

## What's Fixed

✅ **Chat now extracts user info automatically**
- Email, phone, name, location
- LinkedIn, GitHub URLs
- Sponsorship, salary
- Saves to profile automatically

✅ **Resume upload fixed**
- Direct API call from sidepanel
- Proper FormData handling
- Better error messages

✅ **Server auto-configured**
- API key from existing project
- Running on port 3002
- Ready to use

---

## Example Chat Conversation

**You:**
```
My name is Sreekanth Gopi
Email: sreekanthgopi@gmail.com
Phone: +1-650-555-1234
Location: San Francisco, CA
LinkedIn: linkedin.com/in/sreekanthgopi
GitHub: github.com/sreekanthgopi
I don't need visa sponsorship
Salary: $120k-$150k
Can start in 2 weeks
```

**AI:**
```
✓ Saved your information!
Thank you! I now have your complete profile. 
Ready to help you fill job applications!
```

Then just scan any job page and click "Start Filling"!

---

**🎉 You're all set! Happy job hunting!**
