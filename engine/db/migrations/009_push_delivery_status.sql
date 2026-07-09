-- sendExpoPush previously discarded Expo's per-token delivery response, so a
-- rejected push (bad token, revoked credentials, etc.) failed completely
-- silently -- no log, no user-visible signal, nothing to query. That's a
-- plausible root cause for "the reminder never fires and I never open the
-- app": the failure was real but invisible.
-- last_push_error: message from the most recent failed delivery attempt,
-- cleared on the next successful send.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_push_error text;
