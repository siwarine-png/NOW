-- 'weekly' was in the original schema's cadence CHECK but never actually
-- offered anywhere in the client or handled specially in the engine --
-- 'monthly' is the real gap: a genuinely monthly task (e.g. "send provision
-- budget to sister") had no correct cadence to pick, and defaulted to
-- 'daily' -- resurfacing (and getting marked done, then un-done the next
-- day) every single day instead of once a month. See engine/src/engine/
-- stats.js's cadence-aware loadStats and AddPainPointScreen.js's recurrence step.
ALTER TABLE commitments DROP CONSTRAINT IF EXISTS commitments_cadence_check;
ALTER TABLE commitments ADD CONSTRAINT commitments_cadence_check
  CHECK (cadence IN ('once','daily','weekly','monthly'));
