const crypto = require('crypto');
const sb = require('../db/client');

// Cache app lookups for 60s to avoid a DB hit on every request
const cache = new Map(); // key_hash -> { app, expiresAt }

function hashKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function auth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const raw = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!raw) return res.status(401).json({ error: 'Missing API key' });

  const hash = hashKey(raw);
  const cached = cache.get(hash);
  if (cached && cached.expiresAt > Date.now()) {
    req.app_id = cached.app.id;
    req.app = cached.app;
    return next();
  }

  const { data, error } = await sb
    .from('apps')
    .select('id, name, webhook_url, webhook_secret')
    .eq('api_key_hash', hash)
    .single();

  if (error || !data) return res.status(401).json({ error: 'Invalid API key' });

  cache.set(hash, { app: data, expiresAt: Date.now() + 60_000 });
  req.app_id = data.id;
  req.app = data;
  next();
}

module.exports = { auth, hashKey };
