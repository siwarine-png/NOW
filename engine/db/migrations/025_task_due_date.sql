-- A task with a specific time (window_start/window_end) previously had no
-- way to say WHICH day that time applied to -- "3pm" alone repeats every
-- day forever until checked done, even for a genuinely one-time task meant
-- for a single specific date. due_date is that missing piece: null keeps
-- today's behavior (recurring habits, medication, anything not date-bound),
-- set means "don't surface or push this before that calendar date."
ALTER TABLE commitments ADD COLUMN due_date date;
