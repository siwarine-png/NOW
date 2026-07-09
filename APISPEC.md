# SPEC.md — Execution Engine API

**Codename:** ENGINE
**Role:** Core infrastructure for the entire product portfolio. Every client app (planner, habit app, coach platform) integrates through this API. No app bypasses it.
**One-liner:** An API that converts intentions into actions — clients register commitments, the engine predicts drop-off and returns the single best intervention at the right moment.

---

## 0. Principles

1. **API-first, customer-zero discipline.** Own apps use the same public API, keys, and rate limits as external customers. No direct DB access from clients. Ever.
2. **Deterministic before intelligent.** v1 is a rules engine. No ML, no LLM in the intervention path. Explainable, cheap, debuggable.
3. **Log everything, forever.** Every write emits an append-only event. Every intervention's outcome is closed by a later check-in. This labeled dataset (state → intervention → acted/ignored) is the moat.
4. **Engine never talks to end users.** Delivery (push, LINE, email) is the client's job. The engine emits webhooks only.
5. **Multi-tenant from day one.** Everything hangs off `app_id`. A new portfolio product = a new row in `apps`, zero engine changes.

---

## 1. Architecture

```
Client App ──HTTPS/JSON──> API (Node) ──> Postgres (Supabase)
                              │
                              ├── Rules Engine (R1–R8)
                              ├── Risk Scorer (deterministic)
                              ├── Scheduler (5-min worker) ──> Webhooks (HMAC-signed)
                              └── Event Log (append-only)
```

- **Stack:** Node.js single service, Supabase Postgres, Vercel or VPS. Scheduler = pg_cron or polling worker. No Redis at MVP.
- **Auth:** per-app API keys, `Authorization: Bearer sk_live_...`
- **Repo layout (monorepo):**

```
/engine        — API service (this spec)
/clients/momentum — first client product (see PROTOTYPE)
/sdk/js        — 30-line fetch wrapper + types
/docs          — integration guide, Postman collection
```

---

## 2. Data model

```sql
CREATE TABLE apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  api_key_hash text NOT NULL,
  webhook_url text,
  webhook_secret text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid REFERENCES apps(id),
  external_ref text NOT NULL,        -- client's own user id; engine stores no PII
  timezone text DEFAULT 'UTC',
  UNIQUE (app_id, external_ref)
);

CREATE TABLE commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  title text NOT NULL,
  next_action text,                  -- the physical first step
  why text,
  identity_tag text,                 -- "writer", "runner"
  cadence text NOT NULL DEFAULT 'once',  -- once | daily | weekly
  window_start time,
  window_end time,
  deadline timestamptz,
  status text NOT NULL DEFAULT 'active', -- active | completed | abandoned | paused
  created_at timestamptz DEFAULT now()
);

CREATE TABLE checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id uuid REFERENCES commitments(id),
  result text NOT NULL,              -- done | partial | skipped
  energy smallint,                   -- 1–5 optional
  context jsonb,
  evidence_url text,
  occurred_at timestamptz DEFAULT now()
);

CREATE TABLE interventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id uuid REFERENCES commitments(id),
  rule_id text NOT NULL,
  payload jsonb NOT NULL,
  issued_at timestamptz DEFAULT now(),
  outcome text,                      -- acted | ignored | unknown
  outcome_at timestamptz
);

CREATE TABLE events (
  id bigserial PRIMARY KEY,
  app_id uuid, user_id uuid,
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);
```

---

## 3. API surface (v1)

Base: `https://api.<domain>/v1` — all JSON, all authenticated.

| Method | Path | Purpose |
|---|---|---|
| POST | `/users` | Register end user `{ external_ref, timezone }` |
| POST | `/commitments` | Create intention (title, next_action, why, identity_tag, cadence, window, deadline) |
| GET | `/commitments?user_id&status` | List |
| PATCH | `/commitments/{id}` | Update status / window / next_action |
| POST | `/checkins` | Record result `{ commitment_id, result, energy?, context?, evidence_url? }` → returns streak + new risk. **Side effect:** closes any open intervention from last 24 h (`acted` if done/partial, `ignored` if skipped) |
| GET | `/interventions/now?user_id&energy&context` | **Money endpoint** — highest-risk actionable commitment + best intervention (see §4–5). `204` if nothing actionable |
| GET | `/risk?user_id` | Risk per active commitment + top factor |
| GET | `/patterns?user_id` | Aggregates: best hour, completion by weekday, streaks, most effective framing |
| — | Webhook `intervention.suggested` | Scheduler pushes intervention to client's `webhook_url`, HMAC-signed, 3 retries |

### `/interventions/now` response shape

```json
{
  "commitment_id": "uuid",
  "action": "Put on shoes, step outside",
  "framing": "streak",
  "message": "3-day streak on Morning run. Today's version: put on your shoes and step outside. That counts.",
  "friction_reduction": "2-minute version",
  "why_this": "Window closes in 45 min; your in-window completion rate is 78%",
  "risk": 0.61,
  "rule_id": "R3_window_closing",
  "intervention_id": "uuid"
}
```

---

## 4. Rules Engine v1

Priority-ordered; first match wins. Each rule = a known behavior-change mechanism.

| ID | Trigger | Intervention | Mechanism |
|---|---|---|---|
| R1_streak_at_risk | streak ≥ 3, no check-in today, window closes < 90 min | Don't-break-the-chain + 2-min version | Loss aversion |
| R2_missed_yesterday | missed yesterday (daily cadence) | "Never miss twice — smallest version today" | Recovery framing |
| R3_window_closing | in window, < 60 min left, no check-in | Urgency + personal in-window completion rate | Implementation intention |
| R4_ambiguous_action | next_action null or > 80 chars | "Define the physical first step" | Next-action clarification |
| R5_identity_reinforce | check-in done, identity_tag set | "Evidence logged: you acted like a {tag} today" | Identity votes |
| R6_low_energy_downshift | energy ≤ 2 | 2-minute version only, "maintenance counts" | Friction reduction |
| R7_deadline_proximity | deadline < 48 h, behind pace | Escalation + optional notify-partner flag | Social accountability |
| R8_stale_commitment | 7+ days silent, still active | Suggest pause/renegotiate, don't nag | Trust preservation |

**Personalization v0:** once a user has ≥ 10 closed intervention outcomes, prefer the framing with their highest `acted` rate. A GROUP BY, not a model.

---

## 5. Risk score v1 (explainable)

```
risk = clamp01(
    0.30 * missed_yesterday
  + 0.20 * (1 - completion_rate_14d)
  + 0.20 * window_pressure          // 1 - time_left/window_length, 0 outside window
  + 0.15 * streak_fragility         // 1 if streak in [1,3]
  + 0.15 * deadline_pressure )      // max(0, 1 - hours_to_deadline/72)
```

Always return `top_factor`. Replace with a learned model only after thousands of closed outcomes.

---

## 6. Pricing

Free 100 MAU (no webhooks) → Builder $99/mo, 2k MAU → Scale $499/mo, 20k MAU → $0.01/MAU overage.
MAU = distinct users with ≥ 1 check-in that month.

---

## 7. Build order (solo, 3 weeks)

1. **W1:** schema, auth, CRUD, event logging, risk score, `/interventions/now` with R1–R4
2. **W2:** first client product consumes the API end-to-end (customer zero)
3. **W3:** scheduler + webhooks + R5–R8, outcome closing, `/patterns`, docs + Postman + Stripe metered billing

## 8. Non-goals (v1)

No ML/LLM in intervention path · no direct end-user messaging · no user-facing engine dashboard · no calendar/wearable/location integrations · English templates only (i18n = template table later, not a rewrite).

## 9. Moat statement

Endpoints are clonable in two weeks. The closed-loop dataset — (user state, intervention, acted/ignored) at scale, across every client app — is not. Every design decision above exists to grow and protect that dataset.
