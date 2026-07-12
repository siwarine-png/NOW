/**
 * Shared by POST /checkins (a step finished 'done') and PATCH /commitments/:id
 * (a step was Removed/abandoned, or otherwise closed out) -- either way, a
 * decomposed multi-step project (parent_commitment_id, see routes/interventions.js's
 * "only the current smallest step shows" rule) needs the same thing: surface
 * exactly one step at a time, and don't let a skipped/abandoned step leave
 * the whole project silently stuck with nothing left active.
 */
const sb = require('../db/client');

// Activates the earliest still-'paused' sibling under the same parent
// (created_at order). If nothing's left to queue, and every sibling is now
// completed/abandoned, the parent itself is marked done -- closing the loop
// on the whole project either way a step got resolved.
async function advanceSiblingChain(parentId) {
  const { data: siblings } = await sb
    .from('commitments')
    .select('id, status')
    .eq('parent_commitment_id', parentId)
    .order('created_at', { ascending: true });
  if (!siblings?.length) return;

  const nextQueued = siblings.find(s => s.status === 'paused');
  if (nextQueued) {
    await sb.from('commitments').update({ status: 'active' }).eq('id', nextQueued.id);
    return;
  }

  const allDone = siblings.every(s => s.status === 'completed' || s.status === 'abandoned');
  if (allDone) await sb.from('commitments').update({ status: 'completed' }).eq('id', parentId);
}

module.exports = { advanceSiblingChain };
