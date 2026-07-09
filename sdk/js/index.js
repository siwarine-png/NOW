/**
 * ENGINE SDK — 30-line fetch wrapper
 * Usage: const engine = createClient('https://api.example.com', 'sk_live_...')
 */
function createClient(baseUrl, apiKey) {
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
  const req = (method, path, body) =>
    fetch(`${baseUrl}/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
      .then(r => r.status === 204 ? null : r.json().then(d => { if (d?.error) throw new Error(d.error); return d; }));

  return {
    users:       { register: b => req('POST', '/users', b), update: (id, b) => req('PATCH', `/users/${id}`, b) },
    commitments: { create: b => req('POST', '/commitments', b), list: p => req('GET', `/commitments?${new URLSearchParams(p)}`), update: (id, b) => req('PATCH', `/commitments/${id}`, b) },
    checkins:    { create: b => req('POST', '/checkins', b) },
    interventions: { now: p => req('GET', `/interventions/now?${new URLSearchParams(p)}`) },
    risk:        { get: p => req('GET', `/risk?${new URLSearchParams(p)}`) },
    patterns:    { get: p => req('GET', `/patterns?${new URLSearchParams(p)}`) },
  };
}

if (typeof module !== 'undefined') module.exports = { createClient };
