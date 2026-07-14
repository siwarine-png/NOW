-- Parking Lot -- capture a new idea without it becoming a real commitment
-- that competes in the DO-THIS-NOW rotation. The specific gap this closes:
-- today, the only way to record a new idea is the full AddPainPointScreen
-- wizard, which asks for kind/axis/schedule up front -- friction that
-- either gets skipped (the idea is lost) or completed anyway (it starts
-- pulling attention from whatever's already in flight, the exact
-- "shiny new idea" pattern the Evening Debrief's Ship-or-Kill framing
-- exists to guard against). A parked item is just a title until someone
-- deliberately converts it later.
CREATE TABLE parking_lot_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'parked' CHECK (status IN ('parked', 'converted', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX parking_lot_items_user_idx ON parking_lot_items(user_id, status, created_at DESC);
