-- "I'm busy" (NowScreen) -- an on-demand, ad-hoc version of quiet_start/
-- quiet_end for "starting now, don't nudge me for a while," since quiet
-- hours are a fixed daily schedule and this needs to cover an unplanned
-- meeting/errand/whatever happening right now. GET /interventions/now and
-- the scheduler's push ticks both check this before doing anything else.
ALTER TABLE users ADD COLUMN IF NOT EXISTS busy_until timestamptz;
