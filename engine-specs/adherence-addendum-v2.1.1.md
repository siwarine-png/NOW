# NOW Engine — API v2.1 Addendum: Adherence Profile

**Version:** v2.1.1
**Changelog from v2.1:** adds Section 1.1, clarifying how this addendum's scoring (R16) relates to the Adaptive Nudge Engine spec's Momentum Score, now that both exist. No rule, invariant, or data model changes — documentation-only delta.
**Status:** additive addendum to v2. Nothing in v2 (R1–R15) is removed or renumbered.
**Delta from v2:** adds evidence-weighted observations (R16), the regimen-immutability invariant (I5), the `substitutable` domain flag (R9 amendment), regimen-native cue sourcing (R12.4), and missed-dose handling (R17). Introduces the `adherence` domain class, the first domain class with hard safety constraints.
**Scope note:** everything here applies to any domain flagged `class: adherence`. Non-adherence domains are untouched.

---

## 0. New invariants (join the v1/v2 invariant list — do not relitigate per rule)

- **I5 — Regimen immutability.** The engine schedules, cues, and verifies actions *within* a prescribed regimen. It never modifies, interprets, reinterprets, or advises on the regimen itself — not dose, not frequency, not timing windows beyond what the regimen specifies, not substitution, not discontinuation. The regimen is external, authoritative input. Any feature that would require the engine to reason *about* the regimen (interactions, titration, missed-dose compensation) is out of scope by invariant, not by roadmap.
- **I6 — No clinical inference.** Engine outputs (scores, statuses, trends) describe *completion behavior only*. They are never framed, surfaced, or exported as clinical assessments, symptom measures, or treatment recommendations.
- Restated for emphasis in this class: the v1 confirmation invariant is load-bearing here. `confirmed` adherence status derives **only** from the individual's own verified events (per R15's individual-only interval computation). Population priors may rank and default; they may never confirm. In this domain class, that is a compliance property, not a style preference.

---

## 1. What's new, in one paragraph

v2 made the engine opinionated on day one. v2.1 makes it safe to point at medication. Three things change when the action being tracked is a prescribed dose: the action cannot be swapped (R9 must be disabled), the observation can be *verified* rather than merely reported (R16), and the failure mode of a bad suggestion is no longer zero (I5, R17). Everything else — the blend, the confidence graduation, the cue ladder — carries over unchanged, which is the point: adherence is the domain the formulation fits best, provided these guardrails are invariants rather than conventions.

### 1.1 Relationship to the Adaptive Nudge Engine's Momentum Score

The Adaptive Nudge Engine spec (MVP1, v1.1) introduces a separate per-behavior signal, `momentum_score`, used to adjust nudge frequency at runtime. It is intentionally **not** the same mechanism as R16's `effective_n`/`individual_weight`, and the two should not be merged:

- **R16 answers "how confident is the engine in the completion status."** It's tier-weighted evidence feeding a credible interval (R15), and it determines `provisional`/`confirmed` status — a compliance-relevant classification, subject to I5/I6.
- **`momentum_score` answers "how should the reminder behave today."** It's a bounded runtime signal (logistic growth/decay) that only ever touches cue timing/frequency, never status or classification.
- For any domain flagged `class: adherence`, `momentum_score` may adjust cue timing **within** the regimen's tolerance window only — same I5 boundary R12.4 already establishes for cue optimization generally. It has no read or write access to `score`, `status`, or `evidence_mix` in this addendum's data model, and it is never part of the R17.2 disclosure summary (that summary is status/pattern-based, per I6, not a delivery-mechanics artifact).
- Net effect: a low-momentum day can make the reminder fire earlier or more often inside the tolerance window; it cannot change what gets reported as adherence, and it carries no clinical inference. Keeping these signals architecturally separate is what makes that guarantee auditable rather than a matter of trusting the blend logic.

---

## 2. Domain class definition

```json
{
  "domain": "med_evening",
  "class": "adherence",
  "substitutable": false,
  "regimen": {
    "source": "external",
    "dose_events_per_day": 2,
    "window": { "anchor": "regimen_specified", "tolerance_minutes": 60 },
    "missed_dose_instruction": "external | none"
  }
}
```

- `class: adherence` activates I5, I6, R16 tier requirements, R9 disablement, and R17.
- `regimen.source` is always `external` — regimens enter the system via integration or manual entry by the user/clinic, never generated.
- `missed_dose_instruction` is either an externally supplied string (pharmacist/prescriber standard text) or `none`, in which case R17's fallback applies.

---

## 3. Rule definitions

### R9 — amended: substitutability flag

R9/R9a/R9b (two-strikes substitution, tiebreak, floor-tier pause offer) now check `substitutable` before firing.

- `substitutable: false` → R9 and R9a are **fully disabled** for this domain. There is no "one tier down" for a prescription. Repeated skips flow to R17 instead.
- R9b (pause offer) is **replaced** in adherence domains by R17.3 — the engine never offers to pause a medication domain on its own initiative; pausing a regimen is a regimen change (I5).
- Non-adherence domains default `substitutable: true`; behavior unchanged from v2.

### R12.4 — Regimen-native cue sourcing (extends R12)

For adherence domains, the cue ladder is seeded from the regimen, not from templated defaults:

- If the regimen specifies an anchor ("with breakfast," "before bed," "every 12h"), the initial cue is `anchor_time` or `anchor_event` **derived from the regimen**, entering at `source: templated` but with confidence floor above generic (regimen-specified timing is a stronger prior than any population default).
- R12.3's population-content defaults apply only when the regimen specifies no timing at all.
- Cue *optimization* (nudging the reminder earlier/later within the tolerance window based on completion patterns) is permitted — it operates inside the regimen's stated window, so it does not violate I5. Optimization outside the window is prohibited.
- Promotion ladder (`templated → inferred → confirmed`) unchanged.

### R16 — Evidence-weighted observations (new, applies to all domain classes; required for adherence)

Every observation now carries a `verification_tier` that scales its weight in R13's blend and R15's interval computation:

| Tier | Source | Weight (initial, tune via holdout) |
|---|---|---|
| `stated` | R14 card taps, intention signals | 0.25 |
| `reported` | Manual tap / self-report | 1.0 |
| `verified` | Sensor event (pill box open, dispenser count, NFC at location, connected device) | 1.5 |

```
effective_n = Σ (observation_i × tier_weight_i)
individual_weight = effective_n / (effective_n + k)
```

- R15's credible interval is computed on tier-weighted individual observations only (per the v2 R15 fix). Consequence by design: **verified observations graduate a domain out of provisional status faster.** This is the formal link between the hardware track and the engine — verification buys confidence, measurably.
- Tier weights are config values from day one (per the v2 `k` discipline), tuned against holdout data.
- **Adherence-specific requirement:** any adherence status exported to a third party (clinic dashboard, API consumer) must disclose the tier composition backing it (e.g., `evidence_mix: {reported: 0.8, verified: 0.2}`). A status built mostly on self-report must be distinguishable from a sensor-verified one at the consuming end.
- Anti-gaming note: `verified` tier attests that the *device event* occurred (box opened, bottle lifted), not that ingestion occurred. Naming discipline matters — export field names must say `verified_event`, never `verified_ingestion`.

### R17 — Missed-dose and repeated-skip handling (new, adherence class only; replaces R9's role)

**R17.1 — single missed dose:** the engine surfaces exactly one of:
  (a) the externally supplied `missed_dose_instruction` verbatim, or
  (b) if `none`: a fixed, non-generated string — "Check with your pharmacist about what to do for a missed dose."
The engine never generates missed-dose advice. Not templated, not inferred, never. This is I5 applied to the highest-severity edge case.

**R17.2 — repeated skips (former R9 territory):** N consecutive misses (config, default 3) triggers a *disclosure prompt*, not a substitution: a single tap-based prompt offering to flag the pattern for the user's next clinical touchpoint (generate a summary they can show/send to their prescriber). Framing is strictly neutral — pattern surfaced, no interpretation attached (I6). Declining the prompt suppresses it for a config window; it never escalates on its own.

**R17.3 — no autonomous pause:** the engine never offers to pause an adherence domain (replaces R9b). If the user pauses it themselves, the pause is logged as user-initiated and, at the next R17.2-style touchpoint, included in the disclosure summary. Stopping a medication is a conversation with a prescriber; the engine's only legitimate role is making that conversation easier to have.

**R17.4 — tone constraint:** all adherence prompts and skip responses are affectively flat — no streak-breaking language, no loss framing, no shame-adjacent copy. Skip responses acknowledge and re-cue; they do not editorialize. (Rationale: the population most in need of adherence support is disproportionately the population most sensitized to failure framing. This is a product-safety rule, not a style guide.)

---

## 4. Data model additions

```json
{
  "domain": "med_evening",
  "class": "adherence",
  "action": "...",
  "score": {
    "value": 0.66,
    "individual_weight": 0.71,
    "effective_n": 12.5,
    "status": "provisional | confirmed",
    "evidence_mix": { "stated": 0.0, "reported": 0.6, "verified": 0.4 }
  },
  "cue": {
    "type": "anchor_time",
    "display_text": "with dinner",
    "source": "templated | inferred | confirmed",
    "origin": "regimen | population_default | learned",
    "confidence": 0.8,
    "skip_count": 0
  },
  "disclosure_summary_available": false,
  "trend_prompt": null
}
```

- `population_cohort` is **removed from the client-facing response** for adherence domains (and should be reconsidered for all domains, per the v2 review) — cohort membership is internal.
- `origin: regimen` marks cues that inherit I5 protection: they can be optimized within-window but never replaced by a learned cue outside the regimen's window.

---

## 5. API surface

New under `/v2` (additive; `/v1` untouched, `/v2` user-facing count goes from 3 to 5):

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v2/evidence` | Device/sensor evidence events: `{device_id, domain, event_type, timestamp, verification_tier}`. The **only** write path hardware gets. Devices submit events; the engine alone decides observation weighting, status, and promotion. |
| `GET` | `/v2/disclosure/summary` | Returns the R17.2 clinician-shareable summary (completion pattern, evidence mix, user-initiated pauses). Read-only, user-triggered, neutral formatting per I6. |

Boundary restatement (from the two-track plan): hardware and third-party integrations can *only* emit evidence. No external writer can set `status`, `confirmed`, or promotion state. The invariant is enforced at the API boundary, not by convention.

---

## 6. Known risks carried into v2.1 (tracked, not resolved)

- **Tier weights (0.25 / 1.0 / 1.5) are guesses** until holdout data exists. Config from day one, same discipline as `k`.
- **`verified` ≠ ingested.** Pill-box-opened is the ceiling of what consumer sensors honestly attest. Export naming discipline (R16) mitigates misrepresentation; it does not close the gap. Any buyer who needs ingestion-level verification needs different technology than this spec covers.
- **R17.2's disclosure prompt is a UX cliff.** If it reads as surveillance, it will be declined universally and poison trust in the rest of the app. Needs real design and user testing before ship, not just this spec.
- **Regulatory classification is jurisdiction-dependent and framing-dependent.** This spec is written to stay on the wellness/reminder side of the line (I5, I6, R17.1 exist precisely for that), but classification is a determination for regulatory counsel per target market — not something a spec self-certifies. Flag as a required external review before any clinical deployment.
- **Regimen entry is the new cold-start problem.** "Zero typing" (v1 invariant) collides with regimen input. Options — pharmacy/EHR integration, barcode scan of the package, clinic-side entry — each with different build cost and jurisdiction friction. Unresolved; needs its own design doc. Manual typed entry, if ever allowed, is a one-time exception at setup, never in daily use.

---

## 7. Migration notes

- Non-adherence domains: zero behavioral change. R16 tiers apply (all existing observations backfill as `reported`, weight 1.0, so no score shifts on migration day).
- `effective_n` replaces raw `individual_observation_count` in R13/R15 everywhere; for a tap-only history the two are numerically identical, so this is a rename-plus-generalization, not a recompute.
- First adherence deployment should run with the holdout instrumented from day one — the pilot metric for clinical buyers (completion lift vs. holdout, split by evidence tier) is the same artifact as the Track 1 improvement loop. Build once, use twice.
