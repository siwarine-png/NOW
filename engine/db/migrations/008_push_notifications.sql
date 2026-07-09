-- Real daily check-in reminders (was promised at onboarding, never delivered).
-- push_token: Expo push token registered by the client once notification
-- permission is granted; null means "no reminder for this user" -- no
-- separate opt-in flag needed.
-- last_push_sent_at: guards against sending twice in the same day if the
-- scheduler tick and a user's checkin_time land in the same 5-minute window
-- more than once (clock skew, restart, etc.).
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_push_sent_at timestamptz;
