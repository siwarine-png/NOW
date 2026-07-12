-- Lets a user override the rough, priority-weighted desired_hours_per_week
-- computation (identityAggregate.js's computeDesiredHoursPerWeek) with an
-- exact number for a specific axis, for anyone who wants precision instead
-- of a rough split. {axis: hours_per_week} -- an axis absent or null here
-- just falls back to the computed value, same as always.
ALTER TABLE users ADD COLUMN IF NOT EXISTS desired_hours_overrides jsonb;
