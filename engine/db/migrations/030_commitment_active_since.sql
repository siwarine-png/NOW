-- Set when a commitment's "Start" button is pressed (Today's per-row
-- action), cleared when it's finished -- lets the checkin that follows
-- compute a real elapsed duration (now - active_since) instead of only
-- ever recording that something happened, not how long it took. Feeds
-- the Evening Debrief's planned-vs-actual review.
ALTER TABLE commitments ADD COLUMN active_since timestamptz;
