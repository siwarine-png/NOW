# ENGINE Integration Guide

Base URL: `https://api.<domain>/v1`  
Auth: `Authorization: Bearer sk_live_...`

## Quick start

```bash
# 1. Provision your app (internal endpoint — guarded by ADMIN_SECRET)
curl -X POST https://api.example.com/admin/apps \
  -H "X-Internal-Secret: $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"name":"NOW","webhook_url":"https://yourapp.com/webhooks/engine"}'
# → { "app": {...}, "api_key": "sk_live_..." }  ← save this, shown once

# 2. Register a user
curl -X POST .../v1/users \
  -H "Authorization: Bearer sk_live_..." \
  -d '{"external_ref":"usr_123","timezone":"Asia/Bangkok"}'

# 3. Create a commitment
curl -X POST .../v1/commitments \
  -d '{"user_id":"<uuid>","title":"Morning walk","next_action":"Put on shoes, step outside","cadence":"daily","window_start":"07:00","window_end":"09:00"}'

# 4. Get the current intervention (money endpoint)
curl ".../v1/interventions/now?user_id=<uuid>"

# 5. Record a check-in
curl -X POST .../v1/checkins \
  -d '{"commitment_id":"<uuid>","result":"done","energy":4}'
```

## Endpoint reference

| Method | Path | Purpose |
|---|---|---|
| POST | `/users` | Register user `{external_ref, timezone}` |
| PATCH | `/users/:id` | Update timezone / quiet hours |
| POST | `/commitments` | Create commitment |
| GET | `/commitments?user_id&status` | List commitments |
| PATCH | `/commitments/:id` | Update status / next_action |
| POST | `/checkins` | Record result → returns streak + risk |
| GET | `/interventions/now?user_id&energy` | **Money endpoint** — best intervention or 204 |
| GET | `/risk?user_id` | Risk per commitment + top factor |
| GET | `/patterns?user_id` | Best hour, weekday completion, framing effectiveness |

## Webhook

Signed with `X-Engine-Signature: sha256=<hmac>`.  
Event: `intervention.suggested` — fires when scheduler finds actionable commitment.

```json
{
  "event": "intervention.suggested",
  "data": {
    "user_id": "...",
    "commitment_id": "...",
    "intervention_id": "...",
    "rule_id": "R1_streak_at_risk",
    "message": "3-day streak...",
    "action": "Put on shoes, step outside",
    "risk": 0.73
  },
  "ts": 1234567890000
}
```

Verify signature:
```js
const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
if (`sha256=${expected}` !== req.headers['x-engine-signature']) return res.status(401).end();
```

## Rules (R1–R8)

| ID | Trigger | Mechanism |
|---|---|---|
| R1_streak_at_risk | streak ≥ 3, window closes < 90 min | Loss aversion |
| R2_missed_yesterday | missed yesterday (daily) | Recovery framing |
| R3_window_closing | in window, < 60 min left | Implementation intention |
| R4_ambiguous_action | next_action null or > 80 chars | Next-action clarification |
| R5_identity_reinforce | done check-in + identity_tag set | Identity votes |
| R6_low_energy_downshift | energy ≤ 2 | Friction reduction |
| R7_deadline_proximity | deadline < 48h, behind pace | Social accountability |
| R8_stale_commitment | 7+ days silent | Trust preservation |

## SDK (JS)

```js
import { createClient } from '@engine/sdk';
const engine = createClient(ENGINE_URL, API_KEY);

const intervention = await engine.interventions.now({ user_id });
await engine.checkins.create({ commitment_id, result: 'done' });
```
