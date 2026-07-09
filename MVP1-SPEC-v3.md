# MVP1 SPEC — Task Initiation App

**Codename:** NOW (working title)
**Status:** Draft v3 — revises after the Engine v8 build round and the first
production APK. Everything else carried from v2 unless noted.
**Owner:** Tee
**Engine dependency:** Execution Engine API v8, extended this round with R11
(adaptive domain weighting). Still 8 client-facing `/v1/*` endpoints — one was
added and then deliberately removed mid-round to hold that line (see §0).

---

## 0. What changed from v2, and why

v2 shipped the zero-typing onboarding design but left several things as open
questions or future build-sequence steps. This round resolved most of them
against real use, not just design intent:

- **The starter seed library is no longer an open decision.** v2 flagged "who
  curates the starter seed library" as unresolved. It's now 5 domains — Move,
  Fuel, Reset, Progress, Connect — 4 effort tiers each, self-authored by the
  founder as a first pass. Still not externally validated; see §9.
- **A "big picture" reflection strip was added** — five read-only checkboxes
  (Immediate / Today / Week / Month / Longterm) shown on the Done screen and
  the "all caught up" clear screen. This was not in v2 at all. It's
  deliberately a zoom-out lens on the same completion signal already tracked,
  not a set of separate authored goals — the latter would reopen exactly the
  per-domain-goal complexity Engine v6 collapsed away.
- **R11 (adaptive domain weighting) was added.** When multiple domains are
  due the same day, the one you actually follow through on more gets shown
  first — not just whichever is earliest in seed order. A domain with fewer
  than 5 observations scores neutral, so new domains get a fair first look.
- **A custom-domain-authoring path was built, then explicitly reverted.**
  Settings briefly had "Add a personal area" (typing a domain name + up to 4
  effort-tiered actions), backed by a new `POST /equivalents` endpoint. After
  testing it, the founder chose to go back to everyone using the same default
  seed library rather than keeping a self-serve authoring path open — the
  endpoint and UI were removed the same day. Recorded here so this reads as a
  closed decision, not a silent omission.
- **The daily check-in reminder is now real.** v2's onboarding always
  promised "we'll check in with you once a day around 6 PM," but nothing sent
  a notification — that gap went undetected until the first production build
  round. The client now registers an Expo push token on every launch; a
  server-side scheduler fires once, inside a 5-minute window at the user's
  own `checkin_time` in their own timezone, using the actual live
  `pickDomainIntervention` result as the message body (not a generic ping).
- **"Delete all my data" now actually deletes data.** It previously only
  cleared the local app cache while claiming server-side deletion "cannot be
  undone" — a real bug, not a design choice. `DELETE /users/:id` now erases
  the user row and everything tied to it (commitments, checkins,
  equivalents, domain metrics, events).
- **First production APK, first real distribution.** v2's build sequence
  ended at "TestFlight/internal cohort → public release." That step is
  happening now: an EAS internal-distribution build, the founder testing it
  personally first, then handing it to a small group of others for 7 days
  before reviewing usage data via the existing back-office dashboard.

## 1. One-line definition

*(unchanged from v1/v2)* A single-screen app that answers exactly one
question for the ADHD user: **"What do I do right now?"** — powered by
`GET /interventions/now`, with a Done / Not today / Something else response
loop and nothing else visible.

## 2. Strategic context

*(unchanged from v1/v2 — see those docs)*

## 3. In scope

### 3.1 Screens (3 total, unchanged from v2's revision)

| # | Screen | Purpose |
|---|--------|---------|
| 1 | **NOW screen** (home, 95% of usage) | Domain mode (Done/Not today/Something else) for anyone with domain data; commitment mode (Done/Snooze) as a fallback for anyone without it. |
| 2 | **Onboarding** (first launch only) | Zero typing required. See §3.1a. |
| 3 | **Settings** (minimal) | Notification toggle, account info, delete-all-data. No domain editing — that path was built and removed this round (§0). |

### 3.1a Onboarding (unchanged shape from v2, confirmed working end to end)

Two taps, neither requiring typing by default:

1. **Login** (Google Sign-In; stable per-account identity becomes the
   engine's `external_ref`).
2. **Check-in time:** *"We'll check in with you once a day around 6:00 PM —
   good?"* → **Sounds good** or **Pick a different time** (opens a
   forgiving numeric input that live-formats a colon as you type — "1830"
   reads as "18:30" while you're still typing it, not just after submit).

Registration seeds the 5-domain starter library server-side. The very next
screen is NOW, already showing a real, live intervention — there is no
separate "step 3" shown to the user; landing on NOW *is* the first
intervention.

**Confirmed target held:** under 30 seconds to first intervention shown.

### 3.2 NOW screen behavior

- **Done / Not today / Something else**, as specified in v2.
- **Something else** shows up to 3 alternates in the same domain as tap
  targets — confirmed working. **The free-text fallback "one tap further"
  that v2 described was never built.** It remains a real gap, not an
  oversight to hide: right now "Something else" is a closed menu of what's
  already seeded or self-authored, nothing more.
- A `system_suggested` action is promoted to user-confirmed on first
  completion, and its domain's rotation priority adjusts via R11 based on
  ongoing completion rate — both confirmed working.
- **Big picture strip** (new, §0) shown on the Done screen and the clear
  screen.

### 3.3 Data capture

*(unchanged from v2)*, plus: `domain.custom_added` events were logged during
the brief window the custom-domain feature existed; that code path no longer
exists, so no new events of that type will be generated going forward.

## 4. Explicitly out of scope (non-goals)

*(unchanged from v1/v2)*, still holding:

- ❌ Any onboarding field that requires typing before the first intervention
  is shown.
- ❌ Free-text goal authoring anywhere in onboarding, at any point — the
  fixed fictional goal (`compound_self_investment`) stays implicit and
  engine-side, never surfaced.
- ❌ Users authoring their own domains from within the app. This was tried
  and deliberately rolled back this round (§0) — not merely deferred.
- ❌ Impact-weighted personalization (choosing what to show based on
  estimated downstream benefit rather than completion rate). Discussed in
  depth this round and explicitly not built: there is no real "future state"
  measurement to regress against yet, sample size for one user is nowhere
  near enough to fit anything trustworthy, and a live system optimizing on
  spurious correlation is a worse failure mode than the completion-rate bias
  it would try to fix. R11's completion-rate weighting is the ceiling for
  now.

## 5. Architecture

*(unchanged from v1/v2)*, with one addition: the engine's client-facing
surface briefly grew to 9 endpoints (`POST /equivalents`) and was brought
back to 8 the same day when the feature it served was reverted. `DELETE
/users/:id` was added as a new verb on the existing `/users` resource, not a
new endpoint — the freeze is about endpoint *surfaces*, not HTTP verbs on
resources that already exist.

## 6. Positioning & distribution

*(unchanged from v1/v2 strategy)*, now actually underway:

- First EAS production build (`eas build --profile production`, internal
  distribution) built and installed by the founder.
- Getting a real standalone build working surfaced two real infrastructure
  gaps, now fixed: EAS's cloud build servers don't read a local `.env` file
  at all (env vars must be registered via `eas.json`'s `env` block for
  non-secret values, or `eas env:create --visibility sensitive` for the
  engine API key — `secret` visibility is rejected for any `EXPO_PUBLIC_*`
  variable, since those are always embedded in plain text in the compiled
  app by design); and a release build shows a blank white screen with zero
  diagnostic info on any uncaught render error, which a top-level error
  boundary now fixes by rendering the actual error text on screen instead.
- **Known residual risk, accepted for a small trusted test group:** the
  engine API key is embedded in the APK and is not scoped per user — anyone
  with a copy of the APK could technically extract it and call the API
  directly. Acceptable for a 7-day test with people you know; would need
  real per-user auth before any wider distribution.
- Next: hand the APK to a small group of testers for 7 days, then pull usage
  data via the existing `/admin/*` back-office dashboard.

## 7. Success criteria & MVP2 trigger

*(unchanged from v2)*, plus the leading indicator it named
(onboarding-to-first-intervention completion rate) is now actually
measurable in production, not just in design intent.

## 8. Build sequence

1. ~~Onboarding flow v2~~ — **done, confirmed working end to end.**
2. ~~NOW screen + Done/Not today/Something-else loop against live engine~~ —
   **done**, plus R11 and the big-picture strip, which weren't in the
   original sequence.
3. ~~Event logging pipeline~~ — **done** (existing back-office dashboard).
4. **Notifications + quiet hours — done this round.** Was previously the
   next undone step; the real gap it left (onboarding promising a reminder
   that never fired) is what prompted building it now, before external
   testers could notice the app doesn't do what onboarding says.
5. Settings + data deletion + default-editing — **data deletion is now
   real; default-editing was tried (§0) and intentionally not kept.**
6. **TestFlight/internal cohort → public release — in progress now**: first
   production APK, founder testing personally, then a 7-day round with
   other real users.

**Engine freeze holds throughout** (see §5 for the one-day exception and
reversal).

## 9. Open decisions (resolve before wider release)

*(carried over, still genuinely open)*:

- What goes in the starter seed library per domain, and how a bad default
  gets caught before it reaches users beyond the founder — the 5-domain set
  is a first pass, not validated against anyone else's actual behavior yet.
- Auth method (LINE vs email), launch market, exact retention % that
  defines "not catastrophic" for MVP2 — unresolved since v1.
- Whether the free-text "Something else" fallback ever gets built, or
  whether the closed-menu-of-alternates behavior turns out to be enough.
- Per-user API auth, if distribution ever grows past a small trusted group
  (see §6's accepted risk).
