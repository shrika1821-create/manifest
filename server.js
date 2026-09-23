require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'submissions.json');

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '[]', 'utf8');
  }
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

function createMailer() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function formatAnswers(data) {
  return Object.entries(data)
    .filter(([key]) => key !== 'consent')
    .map(([key, value]) => {
      const formattedValue = Array.isArray(value)
        ? value.join(', ')
        : value === ''
          ? '(not answered)'
          : String(value);

      return `${key}: ${formattedValue}`;
    })
    .join('\n');
}

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/quiz', async (req, res) => {
  try {
    const data = req.body;

    if (!data || typeof data !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Invalid submission.'
      });
    }

    if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      return res.status(400).json({
        success: false,
        message: 'A valid email address is required.'
      });
    }

    if (data.consent !== true) {
      return res.status(400).json({
        success: false,
        message: 'Consent is required before submitting.'
      });
    }

    const submission = {
      id: crypto.randomUUID(),
      submittedAt: new Date().toISOString(),
      ...data
    };

    const submissions = readSubmissions();
    submissions.push(submission);
    writeSubmissions(submissions);

    const mailer = createMailer();

    if (mailer && process.env.OWNER_EMAIL) {
      const answerText = formatAnswers(submission);

      await mailer.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: process.env.OWNER_EMAIL,
        subject: `New She Already Exists submission — ${data.name || 'Anonymous'}`,
        text: [
          'You received a new She Already Exists quiz submission.',
          '',
          `Submission ID: ${submission.id}`,
          `Submitted: ${submission.submittedAt}`,
          '',
          answerText
        ].join('\n')
      });

      if (process.env.SEND_CONFIRMATION_EMAIL === 'true') {
        await mailer.sendMail({
          from: process.env.MAIL_FROM || process.env.SMTP_USER,
          to: data.email,
          subject: 'Your She Already Exists result',
          text: [
            `Hi ${data.name || 'there'},`,
            '',
            'Thank you for completing She Already Exists.',
            'Your answers have been received safely.',
            '',
            'Your result is now ready on the quiz page.',
            '',
            '— She Already Exists'
          ].join('\n')
        });
      }
    }

    return res.status(201).json({
      success: true,
      id: submission.id
    });
  } catch (error) {
    console.error('Submission error:', error);

    return res.status(500).json({
      success: false,
      message: 'The submission could not be saved.'
    });
  }
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }

  const indexFile = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexFile)) {
    return res.sendFile(indexFile);
  }

  res.status(404).send('Frontend not found. Please add the html file to /public/index.html');
});

app.listen(PORT, () => {
  console.log(`She Already Exists running on http://localhost:${PORT}`);
});
