-- Engine v5-v8: outcome_equivalents / domain_metrics — the substitution system.
-- See DEV-HANDOFF-SUMMARY.md for the full reasoning. Additive: commitments/
-- checkins/interventions are untouched and keep working for anyone using them;
-- this is a parallel model, not a migration of existing data.
--
-- The single fixed outcome (compound_self_investment) is never stored — it's
-- implicit and constant, never surfaced to the user, so it doesn't need a column.

CREATE TABLE outcome_equivalents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain text NOT NULL,                -- 'movement' | 'rest' | 'nutrition' | ...
  action_text text NOT NULL,
  effort_tier int NOT NULL,            -- 1 = lowest effort
  compounds boolean NOT NULL DEFAULT true,
  created_by text NOT NULL DEFAULT 'user' CHECK (created_by IN ('user','system_suggested')),
  last_completed_at timestamptz,       -- R9a tiebreak: most-recently-completed first
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_outcome_equivalents_user_domain ON outcome_equivalents(user_id, domain);

CREATE TABLE domain_metrics (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain text NOT NULL,
  metric_name text NOT NULL,
  created_by text NOT NULL DEFAULT 'system_suggested' CHECK (created_by IN ('user','system_suggested')),
  PRIMARY KEY (user_id, domain)
);

-- checkins now optionally reference which equivalent was acted on (nullable —
-- existing commitment-based checkins have no equivalent and keep working).
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS equivalent_id uuid REFERENCES outcome_equivalents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_checkins_equivalent ON checkins(equivalent_id, occurred_at DESC);

-- A checkin is either against a commitment (R1-R8) or a domain equivalent
-- (R9/R9a/R9b/R10), never both and never neither.
ALTER TABLE checkins DROP CONSTRAINT IF EXISTS checkins_exactly_one_target;
ALTER TABLE checkins ADD CONSTRAINT checkins_exactly_one_target
  CHECK ((commitment_id IS NOT NULL) <> (equivalent_id IS NOT NULL));
