-- Adaptive Executive Engine additions, mapped directly to specific pain
-- points (not a generic redesign):
--   - priority_tier: "I forget to take prescribed medicine" -- critical
--     commitments override normal risk-based rotation entirely (R9).
--   - revision_count / scope_locked_at: "I keep revising MVP1, no actual
--     progress" -- the API itself refuses further scope edits past a
--     threshold unless the caller explicitly ships current scope.
--   - parent_commitment_id: "MVP1 is too complicated" -- a parent with open
--     children is never itself surfaceable; only the current smallest step
--     shows in /interventions/now.
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS priority_tier text NOT NULL DEFAULT 'normal' CHECK (priority_tier IN ('normal','critical'));
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS revision_count int NOT NULL DEFAULT 0;
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS scope_locked_at timestamptz;
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS parent_commitment_id uuid REFERENCES commitments(id) ON DELETE CASCADE;

CREATE INDEX idx_commitments_parent ON commitments(parent_commitment_id) WHERE parent_commitment_id IS NOT NULL;
CREATE INDEX idx_commitments_critical ON commitments(user_id, priority_tier) WHERE priority_tier = 'critical';
