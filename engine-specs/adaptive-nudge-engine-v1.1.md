# Adaptive Nudge Engine — MVP1 Spec

**Version:** v1.2
**Changelog from v1.1:** removes `streak_counter` from `reward_style` (§2) and removes Momentum Score's "stretch/streak framing" allowance for high-M non-adherence domains (§3.5) — R17.4's flat-tone rule (no streak-breaking language, no loss framing) now applies universally, not just to adherence-class domains. Decided directly against the product's own stated values ("it's your life, not a game" — real progress has no reset button the way a broken streak implies): a streak counter contradicts the Momentum Score formula's own design, which deliberately never hard-resets on a miss (gentle asymmetric decay, §3.5) — showing a streak that snaps to zero would misrepresent what the underlying math already believes about the person's progress. This is also why the reasoning in the Adherence Addendum's R17.4 ("the population most in need is most sensitized to failure framing") was never actually adherence-specific — it generalizes.
**Changelog from v1.0:** adds Section 3.5, Momentum Score — a bounded runtime signal that drives ongoing nudge frequency/difficulty after onboarding closes. Does not change Sections 1, 2, 4, or the stopping rules; `confidence_score` in the Nudge Profile is untouched and still means onboarding-window hit-rate.

Scope: get the user opening the app reliably, capture that as a reusable profile, then immediately spend it on the real problem — forgetting medication.

No bandit algorithm, no infinite experiment space. MVP1 is a **seeded, time-boxed test**, not open-ended exploration.

---

## 1. Onboarding → Establish App Usage

### 1a. Seed candidates (don't start from zero)
Ask 3 quick questions at signup instead of blind-testing everything:

1. "What's something you do every single day, no matter what?" → free text or pick from list (wake alarm, coffee, shower, breakfast, commute, lunch, brushing teeth, bedtime)
2. "When do you have the most mental energy?" → morning / midday / evening
3. "How do you want to be reminded?" → push notification / home-screen widget / both

This gives you a **ranked shortlist of 2 candidate anchors** instead of testing 6+ blind.

### 1b. Time-boxed test (7 days)
- Day 1–3: nudge fires at Candidate A (e.g., "after coffee")
- Day 4–7: nudge fires at Candidate B, *unless* A already hit the reliability bar early (see below)
- Track only one signal: **did the user open the app within a 30-min window of the cue?**
- Vary nudge wording lightly across the week (2 tone variants: direct vs. friendly) — log which correlates with opens, but don't treat this as a separate multi-week experiment. It's a cheap tiebreaker, not the main test.

### 1c. Stopping rule
- **Early win:** ≥5 of 6 cues hit in a row → lock it in, stop testing early.
- **End of 7 days:** pick whichever candidate had the higher open-rate. Tie → default to the one the user self-reported as more consistent (question 1 answer).
- **Both under 50%:** don't loop forever. Surface a simple in-app check-in: "This time isn't sticking — want to try a different anchor?" and let the user pick directly. A user override always beats another silent test cycle.

This caps cold start at **one week**, which matters — a habit app that takes a month to "learn you" loses the user before it proves value.

---

## 2. Nudge Profile

Minimal schema — enough to reuse, not so much you're maintaining a research database:

```json
{
  "user_id": "...",
  "primary_anchor": "after_coffee",
  "backup_anchor": "after_alarm",
  "timing_window_minutes": 30,
  "notification_style": "friendly",       // direct | friendly
  "delivery_method": "push",              // push | widget | both
  "reward_style": "affirming_message",    // none | affirming_message (streak_counter removed, v1.2 — see changelog)
  "confidence_score": 0.83,               // hit-rate over test window
  "established_at": "2026-07-09",
  "last_validated_at": "2026-07-09",
  "decay_after_days": 30                  // re-check reliability after this many days of reuse
}
```

`confidence_score` and `decay_after_days` matter for MVP1 specifically because you're about to reuse this profile on a *different* behavior — you need a way to know when the profile itself is going stale, independent of whether the new behavior succeeds.

---

## 3. Reuse: Medication Reminder

This is the actual test of whether Layer 1 is worth building. Key MVP1 rule: **don't assume the profile transfers perfectly — re-validate on the new behavior, but skip re-running the full search.**

### Flow
1. Executive Engine requests: `establish("take medication", frequency="daily")`
2. Nudge Engine pulls `primary_anchor` from profile → "after coffee"
3. Fires medication nudge at that anchor, same notification style/reward style as the profile
4. Tracks a **separate** confidence score for this specific behavior (medication ≠ app-open: pills need to be physically present, so friction is different)
5. **3-day check:** if hit rate ≥ 2/3, keep going and let it run.
6. **If failing (< 2/3 by day 3):** don't restart a full 7-day search. Just fall back to `backup_anchor` from the same profile. Only if *both* anchors fail does this escalate to a fresh mini-onboarding question specific to medication ("Where do you keep your meds? Let's anchor the reminder there instead.")

### Why re-validate instead of trusting the transfer blindly
The app-open anchor proves the user reliably *does something* at that moment — it doesn't prove medication will succeed there (pills might not be in the kitchen when they have coffee). Re-validating on a short 3-day window costs almost nothing and prevents silently locking in a bad anchor for something that actually matters medically.

---

## 3.5 Momentum Score — runtime adaptation after onboarding closes

`confidence_score` (Section 2) is a one-time onboarding-window hit-rate. It answers "did this anchor work during the test." It doesn't answer "how is the user doing *now*, three weeks in" — and MVP1 needs a live signal for that, because the whole point of Layer 1 is reuse: the engine has to know when to push harder and when to back off, not just whether the original anchor was any good.

**Momentum Score (`M`)** is that signal. It's a bounded, per-behavior value in [0, 1], updated once per day per active behavior (app-open, medication, any future behavior):

```
M(t+1) = M(t) + α · (1 − M(t)) · x(t) − δ · (1 − x(t))
```

- `x(t)` — 1 if the cue was hit within its timing window that day, 0 if missed
- `α` — growth rate on a hit (config, tune via holdout; start ~0.15)
- `δ` — decay rate on a miss (config; start ~0.10, slightly gentler than growth so one bad day doesn't erase a week)
- `(1 − M(t))` — the term that keeps this from being a naive compound-growth formula. It caps growth as `M` approaches 1, so early wins move the needle a lot and it flattens out near max rather than growing without bound. This is a deliberate departure from the plain compound-interest framing discussed earlier — real consistency has diminishing marginal effect, and an unbounded exponential would eventually output nonsense.

**Why this earns its place in MVP1 (not scope creep):** `M` isn't a vanity number for a progress bar. It's read by the nudge policy directly:

| `M` range | Nudge frequency | Task/reminder framing |
|---|---|---|
| Low (0.0–0.3) | Higher — re-establish the habit with easy wins | Keep ask minimal, no stretch framing |
| Mid (0.3–0.7) | Standard, shifted just-in-time (closer to the anchor moment) | Normal |
| High (0.7–1.0) | Lower — avoid over-prompting a habit that's sticking | Normal — **not** stretch/streak framing (v1.2: removed universally, not just for adherence; see below) |

**Framing stays flat regardless of `M`, for every domain, not just adherence.** v1.1 only required this for medication (mirroring the Adherence Addendum's R17.4). v1.2 generalizes it: no streak language, no "don't break the chain," no loss framing anywhere `M` is high, win or lose. Two reasons. First, R17.4's own rationale — "the population most in need of support is disproportionately the population most sensitized to failure framing" — was never actually specific to medication; it applies to habit-formation generally. Second, and more structurally: a streak counter directly contradicts what `M`'s own formula believes. `M` is built to *never* hard-reset on a miss — `δ` decays gently, `(1−M)` caps growth, one bad day doesn't erase a week. A literal streak display does the opposite: one miss and it announces zero. Keeping both would mean the UI actively misrepresents the math underneath it.

**Adherence-domain constraint (unchanged from v1.1):** for the medication behavior specifically, `M` may only ever affect *timing/frequency* of the reminder, never the underlying regimen (dose, window, whether the reminder fires at all on a given day). This mirrors the immutability boundary used elsewhere for adherence — the momentum layer adapts delivery, not the prescribed action.

**What it explicitly does not do:**
- It does not replace or feed into `confidence_score` — that field stays a static onboarding artifact.
- It is not exported or surfaced to the user as a "score" in MVP1 — internal signal only, until there's a design pass on whether showing it helps or just adds pressure.
- It does not use the plain compound-interest formula from early exploration (`S_n = S_0 · ∏(1 + c·a·q)`) — that version is unbounded and doesn't self-correct on misses, which makes it a bad fit for anything actually driving product behavior. The logistic form above is the one to implement.

```json
{
  "user_id": "...",
  "behavior": "medication",
  "momentum_score": 0.62,
  "alpha": 0.15,
  "delta": 0.10,
  "last_updated": "2026-07-09",
  "history_window_days": 14
}
```

Kept as a separate record from the Nudge Profile (Section 2) rather than merged into it — one is per-user/per-anchor setup, this is per-behavior/per-day runtime state, and they update on different cadences.

---

## What MVP1 deliberately leaves out (for later layers)
- True multi-armed bandit optimization across all nudge dimensions
- Automatic anchor-conflict resolution when multiple behaviors want the same anchor
- Long-term decay/re-test scheduling beyond a static `decay_after_days` flag
- Generalizing beyond two behaviors (app-open, medication) to a full Executive Engine queue
- Per-user tuning of `α`/`δ` (v1.1 ships with global config defaults; personalizing these is a later layer, same as the tier weights called out as a known risk in the adherence addendum)

These are real gaps but not needed to validate the core loop: *learn once, reuse fast, re-validate cheaply.*
