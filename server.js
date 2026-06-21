require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const Sentry = require('@sentry/node');
const Redis = require('ioredis');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Sentry
Sentry.init({ dsn: process.env.SENTRY_DSN });

// Redis
const redis = new Redis(process.env.REDIS_URL);
redis.flushall();

// Anthropic
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /assess
app.post('/assess', async (req, res) => {
  try {
    const { bodyPart, symptoms, severity, description } = req.body;
    const cacheKey = `assess:${bodyPart}:${severity}`;
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are a sports medicine AI. Analyze this injury and respond ONLY with a raw JSON object. No markdown, no code blocks, no explanation. Just the JSON.

Use EXACTLY these field names:
{
  "injury_type": "string",
  "affected_area": "string",
  "severity_level": 5,
  "recommended_specialist": "string",
  "summary": "string",
  "requires_immediate_care": false
}

Body part: ${bodyPart}
Symptoms: ${symptoms}
Severity: ${severity}/10
Description: ${description}`
      }]
    });

    console.log('Claude raw response:', message.content[0].text);
    const result = JSON.parse(message.content[0].text);
    console.log('Parsed result:', result);
    await redis.setex(cacheKey, 3600, JSON.stringify(result));
    res.json(result);
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /recovery-plan
app.post('/recovery-plan', async (req, res) => {
  try {
    const { assessment } = req.body;
    const cacheKey = `plan:${assessment.injury_type}:${assessment.severity_level}`;
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `You are a physical therapy AI. Generate a 4-week recovery plan and respond ONLY with valid JSON in this format:
{
  "weeks": [
    {
      "week": 1,
      "focus": "string",
      "goal": "string",
      "exercises": [
        {
          "name": "string",
          "sets": number,
          "reps": "string",
          "instructions": "string"
        }
      ]
    }
  ]
}

Assessment:
${JSON.stringify(assessment)}`
      }]
    });

    const result = JSON.parse(message.content[0].text);
    await redis.setex(cacheKey, 3600, JSON.stringify(result));
    res.json(result);
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /alert
app.post('/alert', async (req, res) => {
  try {
    const { symptoms, severity } = req.body;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `You are a medical safety screener. Check for red flags and respond ONLY with valid JSON:
{
  "red_flags": [],
  "urgency_level": "low|medium|high|emergency",
  "recommendation": "string"
}

Symptoms: ${symptoms}
Severity: ${severity}/10`
      }]
    });

    const result = JSON.parse(message.content[0].text);
    res.json(result);
  } catch (err) {
    Sentry.captureException(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RecoverAI server running on port ${PORT}`);
});