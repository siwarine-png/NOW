require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { auth } = require('./middleware/auth');
const { startScheduler } = require('./engine/scheduler');

const app = express();
app.use(cors());
app.use(express.json());

// Health
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// All v1 routes require API key auth
const v1 = express.Router();
v1.use(auth);
v1.use('/users',         require('./routes/users'));
v1.use('/commitments',   require('./routes/commitments'));
v1.use('/checkins',      require('./routes/checkins'));
v1.use('/interventions', require('./routes/interventions'));
v1.use('/risk',          require('./routes/risk'));
v1.use('/patterns',      require('./routes/patterns'));
v1.use('/',              require('./routes/nudge'));
app.use('/v1', v1);

// /v2 -- new capability that would otherwise expand the v1 freeze (see
// MVP1-SPEC-v3.md). Additive only; /v1 is untouched.
const v2 = express.Router();
v2.use(auth);
v2.use('/identity-checkins', require('./routes/identityCheckins'));
app.use('/v2', v2);

// Admin/back-office — gated by ADMIN_SECRET inside admin.js, entirely
// separate from the /v1 surface client apps consume.
app.use('/admin', require('./routes/admin'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[engine] listening on :${PORT}`);
  startScheduler();
});
