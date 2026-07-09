/**
 * Webhook delivery — HMAC-signed, 3 retries with exponential backoff.
 * Engine never talks directly to users; it fires webhooks and the client delivers.
 */
const crypto = require('crypto');

function sign(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function deliver(webhookUrl, webhookSecret, event, data, retries = 3) {
  const body = JSON.stringify({ event, data, ts: Date.now() });
  const sig = webhookSecret ? sign(webhookSecret, body) : null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sig ? { 'X-Engine-Signature': `sha256=${sig}` } : {}),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { ok: true, attempt };
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt === retries) return { ok: false, error: err.message, attempt };
      await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }
  }
}

module.exports = { deliver, sign };
