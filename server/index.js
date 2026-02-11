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
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SUPPORTED_RESUME_EXTENSIONS = new Set(['.pdf', '.txt', '.rtf', '.doc', '.docx']);

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function splitFullName(name) {
  const clean = normalizeText(name);
  if (!clean) return { firstName: '', lastName: '' };
  const parts = clean.split(/\s+/);
  return {
    firstName: parts[0] || '',
    lastName: parts.length > 1 ? parts[parts.length - 1] : ''
  };
}

function inferControlType(field) {
  const explicitControlType = normalizeText(field.controlType).toLowerCase();
  const allowedExplicit = new Set(['file', 'checkbox', 'radio', 'menu', 'menu_prompt', 'menu_proxy', 'textarea', 'richtext', 'text']);
  if (allowedExplicit.has(explicitControlType)) {
    return explicitControlType === 'menu_proxy' ? 'menu' : explicitControlType;
  }

  const fieldType = (field.type || '').toLowerCase();
  const label = normalizeText(field.label).toLowerCase();
  const placeholder = normalizeText(field.placeholder).toLowerCase();
  const fieldId = normalizeText(field.id).toLowerCase();

  if (fieldType === 'file') return 'file';
  if (fieldType === 'checkbox') return 'checkbox';
  if (fieldType === 'radio') return 'radio';
  if (fieldType === 'select-one' || fieldType === 'select-multiple' || fieldType === 'select') return 'menu';
  if (fieldType === 'textarea') return 'textarea';

  const menuHints = [
    'field_select',
    'select...',
    'choose',
    'dropdown',
    'aria-haspopup'
  ];
  const combined = `${fieldId} ${label} ${placeholder}`;
  if (menuHints.some(hint => combined.includes(hint))) {
    return 'menu';
  }

  return 'text';
}

function normalizeFieldsForAnalysis(fields) {
  const normalized = fields.map(field => ({
    ...field,
    controlType: inferControlType(field)
  }));

  for (let index = 0; index < normalized.length - 1; index += 1) {
    const current = normalized[index];
    const next = normalized[index + 1];
    const nextIsSelectProxy = next?.controlType === 'menu' &&
      normalizeText(next.label).toLowerCase() === 'select...' &&
      normalizeText(next.id).toLowerCase().startsWith('field_select____');

    if (nextIsSelectProxy && (current.controlType === 'text' || current.controlType === 'menu')) {
      const currentOptions = Array.isArray(current.options) ? current.options.length : 0;
      const nextOptions = Array.isArray(next.options) ? next.options.length : 0;
      if (current.controlType === 'menu' && currentOptions > nextOptions) {
        next.controlType = 'menu_prompt';
      } else {
        current.controlType = 'menu_prompt';
      }
    }
  }

  return normalized;
}

function getContextFacts(userContext) {
  const profile = userContext?.profile || {};
  const qa = userContext?.qaLibrary || {};
  const nameParts = splitFullName(profile.name || '');
  const resumeText = normalizeText(userContext?.resumeText || '');

  return {
    profile,
    qa,
    resumeText,
    firstName: profile.firstName || nameParts.firstName || '',
    lastName: profile.lastName || nameParts.lastName || '',
    location: profile.location || '',
    email: profile.email || '',
    phone: profile.phone || '',
    linkedin: profile.linkedin || '',
    referralSource: profile.referralSource || qa.referralSource || 'LinkedIn',
    sponsorship: qa.sponsorship || '',
    workAuth: qa.workAuth || '',
    gender: profile.gender || '',
    race: profile.race || '',
    veteranStatus: profile.veteranStatus || '',
    disabilityStatus: profile.disabilityStatus || '',
    salary: qa.salary || profile.salary || '',
    experience: qa.experience || profile.experience || '',
    startDate: qa.startDate || '',
    chatHistory: Array.isArray(userContext?.chatHistory) ? userContext.chatHistory : []
  };
}

function inferCountry(facts) {
  const location = (facts.location || '').toLowerCase();
  if (location.includes('united states') || location.includes('usa') || location.includes(', ga') || location.includes('atlanta')) {
    return 'USA';
  }
  return facts.profile.country || 'USA';
}

function summarizeResume(facts, maxLen = 900) {
  if (!facts.resumeText) return '';
  return facts.resumeText.replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function buildExcitementAnswer(facts) {
  const background = facts.experience ? `${facts.experience} of applied AI/ML experience` : 'applied AI/ML experience';
  return `This role is compelling because it combines practical ML impact with product-facing decision making. I enjoy turning ambiguous business problems into measurable model outcomes, and this aligns with my ${background}. I am especially interested in building reliable systems that improve user workflows and can scale in production. Long term, I want to keep growing as an AI engineer who leads end-to-end model delivery with strong product collaboration.`;
}

function buildMlExperienceAnswer(facts) {
  const resumeSummary = summarizeResume(facts, 700);
  if (resumeSummary) {
    return `I have worked on both deep learning and non-deep-learning models in production and research contexts. My experience includes neural networks and sequence models, along with tree-based methods and classical ML for prediction, ranking, and retrieval tasks. I primarily use Python with libraries such as PyTorch, TensorFlow, scikit-learn, and supporting tooling for evaluation, feature engineering, and deployment. Recently, I have focused on LLM and retrieval systems, including prompt optimization, ranking quality improvements, and production monitoring.`;
  }
  return `I have hands-on experience with both deep learning and classical machine learning models, including neural networks and tree-based methods. I use Python-based tooling such as PyTorch, TensorFlow, and scikit-learn to build, evaluate, and deploy models. My work includes model experimentation, feature pipelines, and production integration. I focus on measurable model quality and reliable delivery.`;
}

function inferTextValue(field, facts) {
  const label = `${normalizeText(field.label)} ${normalizeText(field.placeholder)}`.toLowerCase();

  if (label.includes('preferred first name') || label.includes('first name')) return facts.firstName;
  if (label.includes('preferred last name') || label.includes('last name')) return facts.lastName;
  if (label.includes('email')) return facts.email;
  if (label.includes('phone')) return facts.phone;
  if (label.includes('country')) return inferCountry(facts);
  if (label.includes('location')) return facts.location;
  if (label.includes('linkedin')) return facts.linkedin || 'https://www.linkedin.com';
  if (label.includes('sponsorship')) return facts.sponsorship || 'No';
  if (label.includes('authorized to work')) return (facts.workAuth || '').toLowerCase().includes('yes') ? 'Yes' : 'Yes';
  if (label.includes('how did you initially hear') || label.includes('how did you hear')) return facts.referralSource || 'LinkedIn';
  if (label.includes('if you chose greenhouse employee') || label.includes('please specify here')) return 'N/A';
  if (label.includes('based in the usa')) return inferCountry(facts) === 'USA' ? 'Yes' : 'No';
  if (label.includes('comfortable moving forward')) return 'Yes';
  if (label.includes('non-compete') || label.includes('non-solicitation')) return 'No';
  if (label.includes('excites you about this position')) return buildExcitementAnswer(facts);
  if (label.includes('machine learning and deep learning')) return buildMlExperienceAnswer(facts);
  if (label.includes('salary expectation') && facts.salary) return facts.salary;
  if (label.includes('available start') && facts.startDate) return facts.startDate;
  if (label.includes('years of experience') && facts.experience) return facts.experience;

  if (facts.firstName && facts.lastName && label.includes('full name')) {
    return `${facts.firstName} ${facts.lastName}`.trim();
  }

  return '';
}

function inferSelectValue(field, facts) {
  const label = normalizeText(field.label).toLowerCase();

  if (label.includes('authorized to work')) return (facts.workAuth || '').toLowerCase().includes('no') ? 'No' : 'Yes';
  if (label.includes('visa sponsorship')) return (facts.sponsorship || '').toLowerCase().includes('yes') ? 'Yes' : 'No';
  if (label.includes('how did you initially hear') || label.includes('how did you hear')) return facts.referralSource || 'LinkedIn';
  if (label.includes('comfortable moving forward')) return 'Yes';
  if (label.includes('based in the usa')) return inferCountry(facts) === 'USA' ? 'Yes' : 'No';
  if (label.includes('gender')) return facts.gender || 'Prefer not to say';
  if (label.includes('transgender')) return 'Prefer not to say';
  if (label.includes('sexual orientation')) return 'Prefer not to say';
  if (label.includes('ethnicity') || label.includes('race')) return facts.race || 'Prefer not to say';
  if (label.includes('veteran')) return facts.veteranStatus || 'Prefer not to say';
  if (label.includes('disability')) return facts.disabilityStatus || 'Prefer not to say';
  if (label === 'select...') return 'Prefer not to say';

  return '';
}

function normalizeChoice(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getFieldOptionList(field) {
  if (!Array.isArray(field.options)) return [];

  const normalized = [];
  const seen = new Set();
  for (const option of field.options) {
    const text = normalizeText(option?.text || option?.label || option?.value);
    const value = normalizeText(option?.value || option?.text || option?.label);
    if (!text && !value) continue;
    const key = `${normalizeChoice(text)}|${normalizeChoice(value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ text, value });
  }
  return normalized;
}

function findMenuOptionMatch(field, desiredValue, facts) {
  const desiredText = normalizeText(desiredValue);
  if (!desiredText) return '';

  const options = getFieldOptionList(field);
  if (options.length === 0) {
    return desiredText;
  }

  const normalizedDesired = normalizeChoice(desiredText);

  // 1. Exact match
  const exact = options.find(option =>
    normalizeChoice(option.text) === normalizedDesired ||
    normalizeChoice(option.value) === normalizedDesired
  );
  if (exact) return exact.text || exact.value;

  // 2. Prefer not to answer patterns (priority over partial match)
  if (normalizedDesired.includes('prefer not') || normalizedDesired.includes('decline')) {
    const preferOpt = options.find(option => {
      const choice = normalizeChoice(option.text);
      return choice.includes('prefer not') || choice.includes('decline') || choice.includes('rather not');
    });
    if (preferOpt) return preferOpt.text || preferOpt.value;
  }

  // 3. Boolean yes/no
  const booleanMappings = {
    yes: ['yes', 'authorized', 'i am', 'true', 'have'],
    no: ['no', 'not', 'false', 'do not', 'don t']
  };
  if (booleanMappings.yes.some(keyword => normalizedDesired.includes(keyword))) {
    const yesOpt = options.find(option => {
      const choice = normalizeChoice(option.text);
      return choice.startsWith('yes') || choice.includes('authorized') || choice.includes('i am');
    });
    if (yesOpt) return yesOpt.text || yesOpt.value;
  }
  if (booleanMappings.no.some(keyword => normalizedDesired.includes(keyword))) {
    const noOpt = options.find(option => {
      const choice = normalizeChoice(option.text);
      return choice.startsWith('no') || choice.includes('not');
    });
    if (noOpt) return noOpt.text || noOpt.value;
  }

  // 4. Gender identity patterns
  if (normalizedDesired.includes('male') && !normalizedDesired.includes('female')) {
    const maleOpt = options.find(option => {
      const choice = normalizeChoice(option.text);
      return choice === 'male' || choice === 'man' || choice === 'cis male' || choice === 'cisgender male';
    });
    if (maleOpt) return maleOpt.text || maleOpt.value;
  }
  if (normalizedDesired.includes('female')) {
    const femaleOpt = options.find(option => {
      const choice = normalizeChoice(option.text);
      return choice === 'female' || choice === 'woman' || choice === 'cis female' || choice === 'cisgender female';
    });
    if (femaleOpt) return femaleOpt.text || femaleOpt.value;
  }

  // 5. Veteran status patterns
  if (normalizedDesired.includes('not a protected veteran') || normalizedDesired.includes('i am not')) {
    const notVetOpt = options.find(option => {
      const choice = normalizeChoice(option.text);
      return choice.includes('i am not') || choice.includes('not a protected');
    });
    if (notVetOpt) return notVetOpt.text || notVetOpt.value;
  }

  // 6. Country patterns
  if (normalizedDesired.includes('united states') || normalizedDesired === 'usa' || normalizedDesired === 'us') {
    const countryOpt = options.find(option => {
      const choice = normalizeChoice(option.text);
      return choice.includes('united states') || choice === 'usa' || choice === 'us' || choice.startsWith('united states');
    });
    if (countryOpt) return countryOpt.text || countryOpt.value;
  }

  // 7. Referral source patterns
  if (normalizedDesired.includes('linkedin') || normalizedDesired.includes('professional network')) {
    const referralOpt = options.find(option => {
      const choice = normalizeChoice(option.text);
      return choice.includes('linkedin') || choice.includes('professional network');
    });
    if (referralOpt) return referralOpt.text || referralOpt.value;
  }

  // 8. Partial contains match
  const contains = options.find(option =>
    normalizeChoice(option.text).includes(normalizedDesired) ||
    normalizeChoice(option.value).includes(normalizedDesired) ||
    normalizedDesired.includes(normalizeChoice(option.text))
  );
  if (contains) return contains.text || contains.value;

  // 9. Fallback inference (only if not already in recursive call)
  if (!facts?.__skipInferFallback) {
    const fallbackDesired = inferSelectValue(field, facts);
    if (fallbackDesired && normalizeChoice(fallbackDesired) !== normalizedDesired) {
      const fallbackMatch = findMenuOptionMatch(field, fallbackDesired, { ...facts, __skipInferFallback: true });
      if (fallbackMatch) return fallbackMatch;
    }
  }

  console.warn(`[Server] No match found for "${desiredValue}" among ${options.length} options in field "${field.label || field.id}"`);
  return '';
}

function inferFieldValue(field, facts) {
  if (field.controlType === 'menu_prompt') return '';
  if (field.controlType === 'menu') {
    const inferred = inferSelectValue(field, facts);
    return findMenuOptionMatch(field, inferred, facts);
  }
  if (field.controlType === 'checkbox' || field.controlType === 'radio') return true;
  if (field.controlType === 'textarea' || field.controlType === 'text') return inferTextValue(field, facts);
  return '';
}

function inferAction(field) {
  if (field.controlType === 'menu_prompt') return 'skip';
  if (field.controlType === 'menu') return 'select';
  if (field.controlType === 'checkbox' || field.controlType === 'radio') return 'check';
  if (field.controlType === 'file') return 'upload';
  return 'type';
}

function sanitizeAndBackfillFillPlan(rawPlan, fields, userContext) {
  const facts = getContextFacts(userContext);
  const validActions = new Set(['type', 'select', 'check', 'skip', 'upload']);
  const fieldMap = new Map(fields.map(field => [field.id, field]));
  const sanitized = [];
  const covered = new Set();
  const warnings = [];
  const existingPlan = Array.isArray(rawPlan) ? rawPlan : [];

  for (const item of existingPlan) {
    if (!item?.fieldId || !fieldMap.has(item.fieldId)) continue;
    const field = fieldMap.get(item.fieldId);
    if (field.controlType === 'menu_prompt') {
      continue;
    }
    let action = normalizeText(item.action).toLowerCase();
    if (!validActions.has(action)) {
      action = inferAction(field);
    }
    if (field.controlType === 'menu' && action === 'type') {
      action = 'select';
    }
    if ((field.controlType === 'checkbox' || field.controlType === 'radio') && action === 'type') {
      action = 'check';
    }

    let value = item.value;
    if ((value === undefined || value === null || value === '') && action !== 'skip' && action !== 'upload') {
      value = inferFieldValue(field, facts);
    }
    if (field.controlType === 'menu' && action === 'select') {
      const matchedValue = findMenuOptionMatch(field, value, facts);
      if (matchedValue) {
        value = matchedValue;
      } else if (Array.isArray(field.options) && field.options.length > 0) {
        warnings.push(`No valid option match for field: ${field.label || field.id}`);
        action = 'skip';
        value = '';
      }
    }
    if (action === 'check') {
      value = value === undefined || value === null || value === '' ? true : value;
    }

    sanitized.push({
      fieldId: item.fieldId,
      action,
      value,
      confidence: typeof item.confidence === 'number' ? item.confidence : 0.8,
      reasoning: item.reasoning || `mapped to ${field.controlType}`
    });
    covered.add(item.fieldId);
  }

  for (const field of fields) {
    const required = Boolean(field.required);
    if (!required) continue;
    if (field.controlType === 'file') continue;
    if (field.controlType === 'menu_prompt') continue;
    if (covered.has(field.id)) continue;

    const action = inferAction(field);
    const value = inferFieldValue(field, facts);
    if ((action === 'type' || action === 'select') && !normalizeText(value)) {
      warnings.push(`Missing value for required field: ${field.label || field.id}`);
      continue;
    }
    sanitized.push({
      fieldId: field.id,
      action,
      value: action === 'check' ? true : value,
      confidence: 0.7,
      reasoning: 'required-field fallback using stored context'
    });
    covered.add(field.id);
  }

  return { fillPlan: sanitized, coverageWarnings: warnings };
}

function heuristicProfileParse(text) {
  const profile = {};
  const qaLibrary = {};
  const firstName = text.match(/First Name\s+([A-Za-z'-]+)/i)?.[1] || '';
  const lastName = text.match(/Last Name\s+([A-Za-z'-]+)/i)?.[1] || '';
  if (firstName && lastName) {
    profile.name = `${firstName} ${lastName}`;
    profile.firstName = firstName;
    profile.lastName = lastName;
  }
  const email = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/)?.[0];
  if (email) profile.email = email;
  const phone = text.match(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/)?.[0];
  if (phone) profile.phone = phone.replace(/[^\d+]/g, '');
  const linkedin = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9-_/]+/i)?.[0];
  if (linkedin) profile.linkedin = linkedin;
  const location = text.match(/City\s+([A-Za-z\s]+),\s*State\s+([A-Za-z\s]+)/i);
  if (location) profile.location = `${location[1].trim()}, ${location[2].trim()}`;
  if (/authorized to work in the united states\s+yes/i.test(text)) qaLibrary.workAuth = 'Yes';
  if (/Need sponsorship\??\s*(Yes|No)/i.test(text)) qaLibrary.sponsorship = text.match(/Need sponsorship\??\s*(Yes|No)/i)?.[1] || '';
  return { profile, qaLibrary };
}

function getMimeTypeFromExtension(ext) {
  const normalized = ext.toLowerCase();
  if (normalized === '.pdf') return 'application/pdf';
  if (normalized === '.txt') return 'text/plain';
  if (normalized === '.rtf') return 'application/rtf';
  if (normalized === '.doc') return 'application/msword';
  if (normalized === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

async function extractResumeTextFromBuffer(filePath, ext, fileBuffer) {
  const normalized = ext.toLowerCase();
  if (normalized === '.pdf') {
    const parsed = await pdfParse(fileBuffer);
    return {
      resumeText: parsed.text || '',
      pages: parsed.numpages || 0
    };
  }

  if (normalized === '.txt' || normalized === '.rtf') {
    return {
      resumeText: fileBuffer.toString('utf-8'),
      pages: 0
    };
  }

  // DOC/DOCX text parsing is intentionally skipped to avoid fragile dependencies.
  return {
    resumeText: '',
    pages: 0
  };
}

async function loadDefaultResumeFromDirectory(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const fileCandidates = entries
    .filter(entry => entry.isFile())
    .map(entry => {
      const ext = path.extname(entry.name).toLowerCase();
      return { name: entry.name, ext };
    })
    .filter(entry => SUPPORTED_RESUME_EXTENSIONS.has(entry.ext));

  if (fileCandidates.length === 0) {
    throw new Error(`No resume files found in ${directoryPath}`);
  }

  const enriched = await Promise.all(fileCandidates.map(async entry => {
    const fullPath = path.join(directoryPath, entry.name);
    const stat = await fs.stat(fullPath);
    return { ...entry, fullPath, modifiedTime: stat.mtimeMs };
  }));

  enriched.sort((a, b) => b.modifiedTime - a.modifiedTime);
  const selected = enriched[0];

  const fileBuffer = await fs.readFile(selected.fullPath);
  const parsed = await extractResumeTextFromBuffer(selected.fullPath, selected.ext, fileBuffer);
  const mimeType = getMimeTypeFromExtension(selected.ext);
  const dataUrl = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;

  return {
    name: selected.name,
    type: mimeType,
    data: dataUrl,
    text: parsed.resumeText || '',
    metadata: {
      pages: parsed.pages || 0,
      filename: selected.name,
      loadedFrom: selected.fullPath,
      loadedAt: new Date().toISOString()
    },
    uploadedAt: new Date().toISOString()
  };
}

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

app.post('/api/load-default-resume', async (req, res) => {
  try {
    const requestedPath = normalizeText(req.body?.path || '');
    const resumeDir = requestedPath
      ? (path.isAbsolute(requestedPath) ? requestedPath : path.join(PROJECT_ROOT, requestedPath))
      : path.join(PROJECT_ROOT, 'resume');

    const resumeFile = await loadDefaultResumeFromDirectory(resumeDir);

    res.json({
      success: true,
      resumeFile
    });
  } catch (error) {
    console.error('❌ Default resume load error:', error);
    res.status(500).json({ error: 'Failed to load default resume', details: error.message });
  }
});

app.post('/api/import-profile-text', async (req, res) => {
  try {
    const requestedPath = normalizeText(req.body?.path || '');
    const resolvedPath = requestedPath
      ? (path.isAbsolute(requestedPath) ? requestedPath : path.join(PROJECT_ROOT, requestedPath))
      : path.join(PROJECT_ROOT, 'profile.txt');

    const profileText = await fs.readFile(resolvedPath, 'utf-8');
    let parsed = { profile: {}, qaLibrary: {} };

    try {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Extract candidate profile facts from free text. Return only JSON with:
{
  "profile": {
    "name": "", "firstName": "", "lastName": "", "email": "", "phone": "",
    "location": "", "linkedin": "", "currentCompany": "",
    "gender": "", "race": "", "veteranStatus": "", "disabilityStatus": "",
    "referralSource": "", "nearestAirport": ""
  },
  "qaLibrary": {
    "sponsorship": "", "workAuth": "", "salary": "", "startDate": "", "experience": ""
  }
}
Only include facts supported by the text.`
          },
          {
            role: 'user',
            content: profileText
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0
      });
      parsed = JSON.parse(completion.choices[0].message.content);
    } catch (error) {
      console.warn('LLM profile import fallback to heuristic parser:', error.message);
      parsed = heuristicProfileParse(profileText);
    }

    res.json({
      success: true,
      profileText,
      profileTextLength: profileText.length,
      profile: parsed.profile || {},
      qaLibrary: parsed.qaLibrary || {}
    });
  } catch (error) {
    console.error('❌ Profile text import error:', error);
    res.status(500).json({ error: 'Failed to import profile text', details: error.message });
  }
});

// Analyze form fields and generate fill plan
app.post('/api/analyze-fields', async (req, res) => {
  try {
    const { fields, userContext, sessionId } = req.body;

    if (!fields || !userContext) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const normalizedFields = normalizeFieldsForAnalysis(fields);
    const requiredNonFileFields = normalizedFields.filter(field =>
      field.required &&
      field.controlType !== 'file' &&
      field.controlType !== 'menu_prompt'
    );

    console.log('\n========== 🔍 FIELD ANALYSIS REQUEST ==========');
    console.log(`📊 Total fields: ${normalizedFields.length}`);
    console.log(`📌 Required non-file fields: ${requiredNonFileFields.length}`);
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
    normalizedFields.slice(0, 10).forEach((f, i) => {
      const opts = f.options?.length ? ` [${f.options.length} options]` : '';
      console.log(`  ${i + 1}. "${f.label}" (${f.type} / ${f.controlType})${opts}`);
      if (f.options?.length > 0 && f.options.length <= 5) {
        console.log(`     Options: ${f.options.map(o => o.text || o.value).join(', ')}`);
      }
    });

    // Build LLM prompt
    const systemPrompt = `You are an intelligent form-filling assistant. Generate a precise fill plan using the user's data.

CRITICAL RULES:
1. USE THE DATA YOU HAVE - Don't ask for information already in the user context.
2. Return one plan item for every REQUIRED field unless it is a file upload field.
2b. Ignore fields where controlType is "menu_prompt" because they are label proxies for adjacent dropdown controls.
3. If field.controlType is "menu", action MUST be "select" (never "type").
4. If field.controlType is "checkbox" or "radio", action MUST be "check".
5. For text/textarea, action MUST be "type".
6. NEVER use placeholder values like "needs_user_input".
7. For missing demographic data, prefer "Prefer not to say" instead of leaving required fields blank.
8. For open-ended required textareas, generate concise, job-relevant answers from resume/profile/chat context.
9. Keep values directly fillable and explicit.

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
${JSON.stringify(normalizedFields, null, 2)}

Fill all required non-file fields. Match action to controlType and prefer deterministic values.`;

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

    const llmResult = JSON.parse(completion.choices[0].message.content);
    const { fillPlan, coverageWarnings } = sanitizeAndBackfillFillPlan(llmResult.fillPlan, normalizedFields, userContext);
    const missingInfo = Array.isArray(llmResult.missingInfo) ? llmResult.missingInfo : [];
    const warnings = [
      ...(Array.isArray(llmResult.warnings) ? llmResult.warnings : []),
      ...coverageWarnings
    ];
    const result = {
      fillPlan,
      missingInfo,
      warnings,
      coverage: {
        requiredNonFileFields: requiredNonFileFields.length,
        generatedPlanItems: fillPlan.length,
        requiredCovered: fillPlan.filter(item => {
          const field = normalizedFields.find(f => f.id === item.fieldId);
          return field?.required &&
            field.controlType !== 'file' &&
            field.controlType !== 'menu_prompt';
        }).length
      }
    };

    console.log('\n✅ LLM RESPONSE:');
    console.log(`   Fill plan: ${result.fillPlan?.length || 0} items`);
    console.log(`   Missing info: ${result.missingInfo?.length || 0}`);
    console.log(`   Warnings: ${result.warnings?.length || 0}`);

    // Log fill plan (NO TRUNCATION)
    console.log('\n📋 FILL PLAN:');
    result.fillPlan?.forEach((item, i) => {
      const valuePreview = item.value; // NO TRUNCATION
      const valueSummary = typeof item.value === 'string' && item.value.length > 100
        ? ` (${item.value.length} characters)`
        : '';
      console.log(`   ${i + 1}. ${item.action.toUpperCase()}: ${item.fieldId}`);
      console.log(`      Value: "${valuePreview}"${valueSummary}`);
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
        fields: normalizedFields,
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
