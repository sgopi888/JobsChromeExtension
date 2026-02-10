import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { OpenAI } from 'openai';
import pdfParse from 'pdf-parse';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// In-memory storage for session data
const sessions = new Map();

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', model: process.env.OPENAI_MODEL || 'gpt-4o-mini' });
});

// Parse resume from PDF
app.post('/api/parse-resume', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('📄 Parsing resume:', req.file.originalname);
    const dataBuffer = await fs.readFile(req.file.path);
    const pdfData = await pdfParse(dataBuffer);

    // Clean up uploaded file
    await fs.unlink(req.file.path);

    // Extract text and metadata
    const resumeText = pdfData.text;
    console.log('✅ Resume parsed:', resumeText.length, 'characters');

    res.json({
      success: true,
      resumeText,
      metadata: {
        pages: pdfData.numpages,
        filename: req.file.originalname,
        parsedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('❌ Resume parsing error:', error);
    res.status(500).json({ error: 'Failed to parse resume', details: error.message });
  }
});

// Analyze form fields and generate fill plan
app.post('/api/analyze-fields', async (req, res) => {
  try {
    const { fields, userContext, sessionId } = req.body;

    if (!fields || !userContext) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log('\n========== 🔍 FIELD ANALYSIS REQUEST ==========');
    console.log(`📊 Total fields: ${fields.length}`);
    console.log(`👤 User context keys:`, Object.keys(userContext));

    // Log user context
    console.log('\n📋 USER PROFILE:');
    if (userContext.profile) {
      Object.entries(userContext.profile).forEach(([key, value]) => {
        if (key === 'resumeText') {
          console.log(`  ${key}: ${value?.length || 0} characters`);
        } else {
          console.log(`  ${key}: ${value}`);
        }
      });
    }

    console.log('\n📚 Q&A LIBRARY:');
    if (userContext.qaLibrary) {
      Object.entries(userContext.qaLibrary).forEach(([key, value]) => {
        console.log(`  ${key}: ${value}`);
      });
    }

    // Log sample fields
    console.log('\n📝 SAMPLE FIELDS (first 10):');
    fields.slice(0, 10).forEach((f, i) => {
      const opts = f.options?.length ? ` [${f.options.length} options]` : '';
      console.log(`  ${i + 1}. "${f.label}" (${f.type})${opts}`);
      if (f.options?.length > 0 && f.options.length <= 5) {
        console.log(`     Options: ${f.options.map(o => o.text || o.value).join(', ')}`);
      }
    });

    // Build LLM prompt
    const systemPrompt = `You are an intelligent form-filling assistant. Generate a precise fill plan using the user's data.

CRITICAL RULES:
1. USE THE DATA YOU HAVE - Don't ask for information already in the user context
2. For text inputs: Use exact values from profile (name, email, phone, location, company, etc.)
3. For dropdowns: Choose the BEST matching option from the list
4. For experience/age ranges: Infer from resume (e.g., "5+ years" if resume shows 5 years)
5. NEVER use "needs_user_input" as a value
6. action must be: "type", "select", "check", or "skip"
7. For skip: only if truly no data AND field not required

Return JSON:
{
  "fillPlan": [
    {
      "fieldId": "field_id_here",
      "action": "type|select|check|skip",
      "value": "actual value",
      "confidence": 0.9,
      "reasoning": "used profile.name"
    }
  ],
  "missingInfo": ["only truly missing critical info"],
  "warnings": []
}`;

    const userPrompt = `USER DATA:
${JSON.stringify(userContext, null, 2)}

FORM FIELDS:
${JSON.stringify(fields, null, 2)}

Fill ALL fields using available data. Don't ask for data you already have.`;

    console.log('\n🤖 Calling OpenAI...');
    console.log(`   Model: ${process.env.OPENAI_MODEL || 'gpt-4o-mini'}`);
    console.log(`   System prompt: ${systemPrompt.length} chars`);
    console.log(`   User prompt: ${userPrompt.length} chars`);

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2
    });

    const result = JSON.parse(completion.choices[0].message.content);

    console.log('\n✅ LLM RESPONSE:');
    console.log(`   Fill plan: ${result.fillPlan?.length || 0} items`);
    console.log(`   Missing info: ${result.missingInfo?.length || 0}`);
    console.log(`   Warnings: ${result.warnings?.length || 0}`);

    // Log fill plan
    console.log('\n📋 FILL PLAN:');
    result.fillPlan?.forEach((item, i) => {
      const valuePreview = typeof item.value === 'string' && item.value.length > 50
        ? item.value.substring(0, 50) + '...'
        : item.value;
      console.log(`   ${i + 1}. ${item.action.toUpperCase()}: ${item.fieldId}`);
      console.log(`      Value: "${valuePreview}"`);
      console.log(`      Confidence: ${item.confidence} - ${item.reasoning}`);
    });

    if (result.missingInfo?.length > 0) {
      console.log('\n⚠️  MISSING:', result.missingInfo.join(', '));
    }

    console.log('\n========== END ANALYSIS ==========\n');

    // Store session
    if (sessionId) {
      sessions.set(sessionId, {
        fillPlan: result.fillPlan,
        fields,
        userContext,
        timestamp: Date.now()
      });
    }

    res.json(result);
  } catch (error) {
    console.error('❌ Field analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze fields', details: error.message });
  }
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, context, history } = req.body;

    console.log('\n💬 Chat request:', message.substring(0, 100));

    const systemPrompt = `You are a helpful assistant in a job application auto-filler. 
Help users by answering questions and providing guidance.
Keep responses concise and actionable.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(history || []),
      { role: 'user', content: message }
    ];

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages,
      temperature: 0.7,
      max_tokens: 500
    });

    const response = completion.choices[0].message.content;
    console.log('✅ Chat response:', response.substring(0, 100));

    res.json({ response, timestamp: Date.now() });
  } catch (error) {
    console.error('❌ Chat error:', error);
    res.status(500).json({ error: 'Chat failed', details: error.message });
  }
});

// Get session state
app.get('/api/session/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json(session);
});

// Update session state
app.patch('/api/session/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const updated = { ...session, ...req.body, timestamp: Date.now() };
  sessions.set(req.params.sessionId, updated);
  res.json(updated);
});

// Start server
app.listen(PORT, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 Jobs AI Server running on http://localhost:${PORT}`);
  console.log(`📝 Model: ${process.env.OPENAI_MODEL || 'gpt-4o-mini'}`);
  console.log(`🔑 API Key: ${process.env.OPENAI_API_KEY ? '✓ Configured' : '✗ Missing'}`);
  console.log(`${'='.repeat(60)}\n`);
});
