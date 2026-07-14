/**
 * Unauthenticated by design -- HatchEm (clients/now/public/hatchem.html) is
 * a standalone static page with no API key of its own to hold, so this
 * can't sit behind the same Bearer-auth wall as /v1 and /v2. Deliberately
 * narrow: this touches no database and no user accounts, nothing beyond
 * proxying a batch of thought text to Groq and returning its analysis (see
 * engine/groq.js's analyzeThoughts). Simple in-memory per-IP rate limit
 * guards the shared GROQ_API_KEY against abuse -- resets on deploy/
 * restart, good enough for a temporary, low-traffic feature, not meant to
 * be bulletproof.
 */
const { Router } = require('express');
const { analyzeThoughts } = require('../engine/groq');

const router = Router();

const RATE_LIMIT = 10; // requests
const RATE_WINDOW_MS = 60 * 60 * 1000; // per hour, per IP
const hits = new Map(); // ip -> [timestamps]

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

const MAX_ITEMS = 30;
const MAX_CHARS = 280;

// POST /public/hatchem/analyze -- { items: [{ text, category }] }
router.post('/hatchem/analyze', async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: 'Too many requests -- try again later' });

  const items = req.body?.items;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items required' });
  if (items.length > MAX_ITEMS) return res.status(400).json({ error: `Too many items (max ${MAX_ITEMS})` });

  const clean = items
    .map((it) => ({
      text: String(it?.text || '').trim().slice(0, MAX_CHARS),
      category: String(it?.category || 'Idea').slice(0, 24),
    }))
    .filter((it) => it.text.length > 0);
  if (!clean.length) return res.status(400).json({ error: 'items required' });

  try {
    const result = await analyzeThoughts(clean);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
