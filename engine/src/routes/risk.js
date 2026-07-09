const { Router } = require('express');
const sb = require('../db/client');
const { loadStats } = require('../engine/stats');
const { scoreRisk } = require('../engine/risk');

const router = Router();

// GET /risk?user_id=
router.get('/', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const { data: user } = await sb.from('users').select('id').eq('id', user_id).eq('app_id', req.app_id).single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { data: commitments } = await sb
    .from('commitments').select('*').eq('user_id', user_id).eq('status', 'active');

  const results = await Promise.all((commitments || []).map(async c => {
    const stats = await loadStats(c.id);
    const { score, top_factor, factors } = scoreRisk(c, stats);
    return {
      commitment_id: c.id,
      title: c.title,
      risk: Math.round(score * 100) / 100,
      top_factor,
      factors,
      streak: stats.streak,
      completion_rate_14d: Math.round((stats.completionRate14d ?? 0) * 100) / 100,
    };
  }));

  results.sort((a, b) => b.risk - a.risk);
  res.json(results);
});

module.exports = router;
