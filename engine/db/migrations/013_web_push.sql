-- Real Web Push (installable PWA + OS-level notification settings), same
-- mechanism the older BECOME prototype already proved out (VAPID + a
-- service worker + the `web-push` library) rather than depending on Expo's
-- less-certain web push abstraction. One subscription per user, same
-- pattern as push_token for native.
ALTER TABLE users ADD COLUMN IF NOT EXISTS web_push_subscription jsonb;
