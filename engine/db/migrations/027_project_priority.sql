-- Relative importance between concurrently active projects (e.g. "Day Arc
-- matters more than BUMP right now") -- distinct from priority_tier, which
-- is a binary urgent-override flag (R9_critical_override), not a ranking.
-- Only meaningful on a project's own parent commitment; a child step reads
-- its parent's value at scoring time (see risk.js). NULL (the default,
-- unset) is treated as "Normal" everywhere it's read.
ALTER TABLE commitments ADD COLUMN project_priority smallint;
