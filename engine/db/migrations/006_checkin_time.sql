-- MVP1-SPEC-v2 onboarding step 2: "We'll check in with you once a day around
-- 6:00 PM — good?" — a single stored preference, separate from wake/sleep
-- (which stay silent defaults now that onboarding no longer asks for them).
ALTER TABLE users ADD COLUMN IF NOT EXISTS checkin_time time DEFAULT '18:00';
