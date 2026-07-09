/**
 * Append-only event log. Every write should call log().
 * Never throws — event logging must not block the response.
 */
const sb = require('../db/client');

async function log(appId, userId, type, payload = {}) {
  try {
    await sb.from('events').insert({ app_id: appId, user_id: userId, type, payload });
  } catch (e) {
    console.error('[events] log error', e.message);
  }
}

module.exports = { log };
