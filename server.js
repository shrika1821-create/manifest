require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'submissions.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const QUIZ_DIR = path.join(__dirname, 'shrukapublic');

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/shrukapublic', express.static(QUIZ_DIR));

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

function readSubmissions() {
  ensureStorage();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (error) {
    return [];
  }
}

function writeSubmissions(submissions) {
  ensureStorage();
  fs.writeFileSync(DATA_FILE, JSON.stringify(submissions, null, 2), 'utf8');
}

async function forwardToGoogleSheet(payload) {
  const url = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  const secret = process.env.GOOGLE_SHEET_SECRET;

  if (!url) {
    return { success: true, skipped: true };
  }

  const consentGiven =
    payload.consent === true ||
    payload.consent === 'true' ||
    payload.consent === 1 ||
    payload.consent === '1';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ...payload,
      secret,
      consent: consentGiven,
      submittedAt: new Date().toISOString()
    })
  });

  const result = await response.json().catch(() => ({}));

  return {
    success: response.ok && result.success === true,
    skipped: false,
    result
  };
}
function cleanSubmission(data) {
  const cleaned = { ...data };
  delete cleaned.secret;
  return cleaned;
}

app.get('/health', (req, res) => {
  res.json({ ok: true, status: 'running' });
});

app.post('/api/quiz', async (req, res) => {
  try {
    const data = req.body;

    if (!data || typeof data !== 'object') {
      return res.status(400).json({ success: false, message: 'Invalid submission.' });
    }

    if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      return res.status(400).json({ success: false, message: 'A valid email is required.' });
    }

    if (data.consent !== true) {
      return res.status(400).json({ success: false, message: 'Consent is required.' });
    }

    const submission = {
      id: crypto.randomUUID(),
      submittedAt: new Date().toISOString(),
      ...cleanSubmission(data)
    };

    const existing = readSubmissions();
    existing.push(submission);
    writeSubmissions(existing);

    const sheetResult = await forwardToGoogleSheet(submission);

    if (!sheetResult.success && !sheetResult.skipped) {
      return res.status(502).json({
        success: false,
        message: 'The quiz was saved locally but the Google Sheet sync failed.'
      });
    }

    return res.status(201).json({ success: true, id: submission.id, sheet: sheetResult.skipped ? 'skipped' : 'synced' });
  } catch (error) {
    console.error('Submission failed:', error);
    return res.status(500).json({ success: false, message: 'Submission failed.' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`She Already Exists is running at http://localhost:${PORT}`);
});
