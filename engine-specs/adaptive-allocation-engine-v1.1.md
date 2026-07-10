# Adaptive Allocation Engine — MVP1 Spec

**Version:** v1.3
**Changelog from v1.2:** unifies the axis model. Every axis — including
Foundation — now has the exact same shape: `baseline_hours_per_week`
(fixed, reserved unconditionally) + a flex portion above it that competes
via gap-ranking, plus **measured** `current_hours_per_week` on all six, not
just five. Foundation previously had no measurement at all (reserved in the
schedule, but nothing tracked whether it actually happened) and never
competed even for its own slack between min/max — both gaps close here.
Renames "floor" to **baseline** throughout for one consistent term. The
*values* stay evidence-honest, not uniform: Foundation/Relationships/Finance
get a non-zero baseline because each has a specific, named research basis
(§2.3); Achievement/Contribution/Recreation get **baseline = 0**, explicitly,
because no equivalent basis exists for treating any part of them as
non-negotiable — same schema field everywhere, no invented floor.
**Status:** Sibling to the Adaptive Nudge Engine (v1.1) and the Adherence
Addendum (v2.1.1) — together these are the three engines behind the product:

| Engine | Question it answers | Status |
|---|---|---|
| **Adaptive Allocation Engine** (this doc) | *How should my available weekly hours be split across what matters to me?* | New — mostly unbuilt |
| Adaptive Executive Engine | *Given a budget, how do I actually start/finish this?* (task decomposition, revision lock, schedule adherence) | Built |
| Adaptive Nudge Engine | *How do I get the user to reliably show up at all?* (anchor cues, Momentum Score) | Built, v1.1 |

This engine sits **above** the other two. It decides the weekly hour budget
per commitment; it does not decide daily task placement (Executive Engine's
job) and it has no opinion on how the user is cued to start (Nudge Engine's
job). Scope: one person, one week, 168 hours.

---

## 1. Why weekly

Not daily (too short — noisy, no room for a bad day to average out) and not
monthly (too long — by the time drift is visible, weeks of misallocation
have already happened). A week is long enough to average over normal
variance and short enough that a bad week is caught and re-planned before it
becomes a bad month. This mirrors the Nudge Engine's own reasoning for
capping cold-start at one week, same underlying principle: don't let the
feedback loop run longer than the cost of being wrong.

---

## 2. Inputs

### 2.1 Foundation's constraints

Sleep, meals, movement, hygiene, rest — reused directly from BECOME's
existing `BLOCK_GUIDELINES`: each has a `minDur`/`maxDur` and a preferred
time-of-day window.

```json
{
  "id": "b_found_n_sl",
  "label": "Sleep",
  "min_minutes": 420,
  "max_minutes": 540,
  "preferred_window": { "start_hour": 21, "end_hour": 23 }
}
```

**Rule:** `min_minutes` becomes Foundation's `baseline_hours_per_week` in
§2.3/§3 — can never be removed and never allocated below it. The room
between `min_minutes` and `max_minutes` is Foundation's *flex*, same concept
as every other axis's flex now (v1.2 called this "discretionary buffer" and
left it outside gap-ranking entirely; v1.3 folds it into the same mechanism
everyone else uses, §3).

### 2.2 Active commitments

User-selected, addable/removable categories — work, a specific project,
family, social, etc.

```json
{
  "id": "c_deep_work",
  "label": "Deep work",
  "identity_axis": "achievement",
  "compounds": true,
  "target_hours_per_week": 20,
  "completion_rate": 0.74,
  "observations": 12
}
```

- `identity_axis` — which spectrum axis (§2.3) this commitment counts toward.
  Replaces the old manual `priority` field: cross-axis ordering is now
  computed from the gap on this axis, not picked by hand per commitment (see
  §3). A commitment still competes with same-axis siblings only via
  `compounds`/`completion_rate` below.
- `compounds` — reused as-is from the existing `equivalents.compounds`
  column. `true` means this action meaningfully builds toward the person's
  stated identity, not just toward this week's to-do list.
- `target_hours_per_week` — the commitment's aspirational ask. May exceed
  what's actually allocatable; that's expected and handled in §3.
- `completion_rate` — measured, not guessed: actual hours completed ÷
  hours previously allocated, trailing window. **Not present** (or
  `observations < 5`) scores neutral (0.5), same floor R11 already uses for
  new domains — a new commitment is never punished for lacking history.

**Explicitly not an input:** any self-reported mood/happiness/satisfaction
signal. Decided directly in discussion: for this user population, avoidance
of hard-but-compounding work frequently *self-reports as good mood*
(relief from friction), while the compounding work itself often self-reports
lower in the moment. A happiness-weighted input would systematically reward
avoidance and punish the exact behavior this engine exists to protect. If an
affect check-in exists anywhere in the product, it is a private journaling
feature with no read access into this engine.

### 2.3 Identity spectrum: how many axes, and what they are

v1.1 used BECOME's existing blueprint categories as-is. v1.2 checked that
set against actual research on what people durably aspire to become, rather
than a coaching heuristic (Wheel of Life) or a wellbeing-measurement
instrument (WHOQOL) bent sideways into a "life domains" taxonomy it wasn't
built for. Two sources actually fit the question being asked:

- **Aspiration Index** (Kasser & Ryan, grounded in Self-Determination
  Theory) — a validated instrument measuring the life goals people actually
  hold, split into *intrinsic* goals (Personal Growth, Affiliation,
  Community) and *extrinsic* goals (Wealth, Fame, Image), plus Physical
  Health as a goal that loads on neither cleanly. Sheldon & Kasser's 1998
  longitudinal study found attaining intrinsic goals predicts higher
  well-being; attaining extrinsic goals largely doesn't.
- **Baumeister & Leary (1995), "The Need to Belong"** — extensively
  replicated evidence that social connection is a fundamental need, not a
  discretionary preference. Combined with Tay & Diener's 2011 cross-cultural
  study (123 countries, Gallup World Poll), which found Maslow's need
  *categories* hold up empirically even though his strict sequential
  hierarchy doesn't (people pursue belonging/esteem in parallel with
  survival needs, not only after them).

Net effect on the axis set — every axis now carries the same
`baseline_hours_per_week` field, but the *value* stays evidence-honest:

| Axis | `baseline_hours_per_week` | Basis |
|---|---|---|
| **Foundation** | `min_minutes` (BLOCK_GUIDELINES) | Physiological/safety needs (Maslow's categories, as confirmed by Tay & Diener) |
| **Relationships** | non-zero | Baumeister & Leary (belonging is a real need) |
| **Finance** | non-zero | Baseline financial security |
| **Achievement** | **0** | No equivalent basis — Aspiration Index's Personal Growth is a want, not a need |
| **Contribution** | **0** | No equivalent basis — Aspiration Index's Community is a want, not a need |
| **Recreation** | **0** | Not in either research source at all (see below) — definitely no basis for a floor |

**Deliberately, permanently excluded: Fame and Image.** Not a research gap —
the opposite. This is the one place more coverage was considered and
rejected on purpose: Sheldon & Kasser's finding is that *attaining* these
goals doesn't improve well-being. Building an engine that helps someone
allocate more of their week toward chasing fame or image would mean
actively assisting a goal the evidence says doesn't help them, which fails
the same ethical bar that ruled out happiness/mood as a scoring input in
§2.2 — the engine should support what's actually good for the person, not
every possible want indiscriminately.

Six axes total, one shared schema, all six now measured — up from v1.1's
three axes and v1.2's "five measured, one not." Every addition or structural
change is either research-backed or an explicit, named exception, never
scope creep for its own sake.

Same shape for every axis now, Foundation included:

```json
{
  "axis": "achievement",
  "baseline_hours_per_week": 0,
  "desired_hours_per_week": 32,
  "current_hours_per_week": 18.5,
  "gap_raw": 13.5,
  "gap_smoothed": 9.2
}
```

```json
{
  "axis": "relationships",
  "baseline_hours_per_week": 3,
  "desired_hours_per_week": 18,
  "current_hours_per_week": 12,
  "gap_raw": 6,
  "gap_smoothed": 4.1
}
```

```json
{
  "axis": "foundation",
  "baseline_hours_per_week": 49,
  "desired_hours_per_week": 63,
  "current_hours_per_week": 52.5,
  "gap_raw": 10.5,
  "gap_smoothed": 6.8
}
```

(Foundation's `desired_hours_per_week` defaults to the *max* end of
BLOCK_GUIDELINES' healthy range, not a personal want — "desired" here means
"the top of the healthy range," not an aspiration the person typed in.)

- `baseline_hours_per_week` — present on every axis now. Non-negotiable
  minimum, reserved in Phase 1 regardless of gap-ranking (§3). Zero for
  Achievement/Contribution/Recreation — an honest value, not an omission.
- `desired_hours_per_week` — sum of `target_hours_per_week` across all active
  commitments tagged to this axis (Foundation: the healthy-range max instead,
  see above). User-set for the five want axes — the engine never invents
  what you want; fixed by BLOCK_GUIDELINES for Foundation.
- `current_hours_per_week` — **measured on all six axes now**, not
  self-assessed: trailing actual hours completed. For the five want axes
  this is the same source data as `completion_rate`, aggregated per axis.
  For Foundation, this requires Foundation blocks to be trackable/completable
  the same way commitments are — not yet true in the NOW engine's data model
  as of v1.3; a real implementation gap, not just a documentation one.
- `gap_raw = desired − current`, floored at 0 (over-delivering on an axis
  isn't a debt the engine tracks or "spends down" elsewhere). For Foundation,
  this is now a genuine reflection signal — e.g. "scheduled 9h sleep,
  averaging 7h" — that v1.2 had no way to represent at all.
- `gap_smoothed` — see §3; this is the value actually used for weighting,
  not `gap_raw`.

---

## 3. Allocation algorithm

Two phases, both deterministic — no ML/LLM in this path, same founding
principle as the other two engines.

### Phase 1 — Reserve every axis's baseline

```
committed_hours = Σ baseline_hours_per_week across all six axes
free_pool = 168 − committed_hours
```

One formula now, not a special case for Foundation plus a separate one for
Relationships/Finance. Achievement/Contribution/Recreation's baselines are
0, so they trivially reserve nothing here — same equation, no branch needed
for them. Every non-zero baseline (Foundation's `min_minutes`,
Relationships', Finance's) is guaranteed before anything else is
distributed, never something that has to win a gap-ranking contest.

### Phase 2 — Distribute the free pool

**Step 1 — smooth each axis's gap**, so a single unusually good or bad week
doesn't yank the whole schedule around:

```
gap_smoothed(t) = β · gap_raw(t) + (1 − β) · gap_smoothed(t − 1)
```

`β` (config; start ~0.3) controls reaction speed — deliberately a plain EMA,
*not* the Nudge Engine's logistic Momentum formula. Momentum answers a
bounded daily hit/miss question; this is an unbounded hours-based gap, and
forcing it into the same [0,1] logistic shape would fit the wrong kind of
quantity just to reuse a formula. First week for an axis with no history:
`gap_smoothed = gap_raw` (no prior to blend against).

**Step 2 — rank axes by `gap_smoothed`, largest first.** All six axes enter
this ranking now, Foundation included — v1.2 excluded it entirely ("never
competes for the free pool"); v1.3 only exempts its *baseline*, not its
flex. If someone's chronically under-resting relative to the healthy-range
max, Foundation's flex can now legitimately win the free pool ahead of
Achievement or anything else that week. This is the cross-axis ordering
that used to be the manual `priority` field: the axis you've most
under-delivered on relative to your own stated (or, for Foundation,
prescribed) goal claims the free pool first.

**Step 3 — within an axis, weight its commitments** exactly as v1.0 did:

```
weight = (compounds ? 1.5 : 1.0) × (0.5 + completion_rate / 2)
```

(`completion_rate` is folded in on a 0.5–1.0 multiplier, not 0–1, so a
struggling commitment still gets a meaningful share rather than being
starved to zero — the point is budget allocation, not punishment.)

**Step 4 — grant, axis by axis, in the §Step 2 order:**

```
axis_ask = Σ target_hours_per_week for commitments on this axis
           minus baseline_hours_per_week (already reserved in Phase 1 — trivially 0 for Achievement/Contribution/Recreation)
if axis_ask <= free_pool:
    grant each commitment its full target_hours_per_week (minus its share of the baseline, already covered)
else:
    grant each commitment target_hours_per_week × (weight / Σ weights on this axis) × (free_pool / axis_ask)
free_pool -= Σ granted this axis
```

The baseline is never re-litigated here for any axis — it's already spent
in Phase 1. This step only ever fights over the *flex* portion above it, so
a bad week can shrink how much *extra* time an axis gets granted, but never
eats into any axis's guaranteed baseline, Foundation included.

**Open detail, deferred rather than resolved here:** how Foundation's own
flex gets split *internally* across its sub-constraints (extra sleep vs.
extra movement vs. extra meal time, when Foundation's axis wins the free
pool) isn't specified yet — the `compounds`/`completion_rate` weight
formula above was built for user-authored commitments, and Foundation's
five sub-constraints aren't that. Needs its own small design pass before
implementation; flagged honestly rather than papered over.

Move to the next axis (next-largest `gap_smoothed`) with whatever
`free_pool` remains. The axis with the biggest gap is always satisfied
first, in full, before the next one sees anything.

### Edge case: free pool exhausted before all axes are processed

Remaining axes get zero this week. This is a real result, not an error — it
means the person's stated commitments exceed their actual available time,
and that should be visible, not silently smoothed over. Because ranking is
gap-driven, a zeroed-out axis this week has its `gap_raw` grow for next
week, which raises its `gap_smoothed` and pulls it toward the front of the
queue next time — the shortfall doesn't get silently forgotten, it
compounds into next week's ordering.

### Edge case: constraints alone consume nearly all 168 hours

If `free_pool` drops below some floor (config; suggest 20 hours as a
starting default), surface this directly to the person rather than
proceeding to silently allocate near-zero slivers across every commitment —
same "surface it, don't loop silently" instinct as the Nudge Engine's
both-anchors-failed stopping rule.

---

## 4. Output

```json
{
  "week_of": "2026-07-13",
  "free_pool_hours": 68.5,
  "baselines_reserved": { "foundation": 49, "relationships": 3, "finance": 2 },
  "axis_order": [
    { "axis": "achievement", "gap_smoothed": 9.2 },
    { "axis": "foundation", "gap_smoothed": 6.8 },
    { "axis": "relationships", "gap_smoothed": 4.1 },
    { "axis": "finance", "gap_smoothed": 1.8 },
    { "axis": "contribution", "gap_smoothed": 0.6 },
    { "axis": "recreation", "gap_smoothed": 0.2 }
  ],
  "allocations": [
    { "commitment_id": "c_deep_work", "axis": "achievement", "granted_hours": 20, "of_target": 20 },
    { "commitment_id": "c_family", "axis": "relationships", "granted_hours": 14, "of_target": 18 }
  ],
  "unmet_axes": []
}
```

This output is a **weekly hour budget per commitment** — nothing more. It
does not say *when* in the week those hours happen (that's either manual
placement, as BECOME already does today, or a future placement pass) and it
does not track daily follow-through (that's the Executive Engine, reading
this budget as its input).

---

## 5. Boundaries with the other two engines

- **Executive Engine** owns everything once a commitment has its weekly
  hours: task decomposition, revision lock, day-to-day schedule adherence.
  This engine never decomposes tasks or touches `revision_count`.
- **Nudge Engine** owns getting the user to initiate at all, and its
  Momentum Score adjusts cue *timing*, never hours or priority. This engine
  never touches cue delivery.
- Neither downstream engine can feed a signal back up that silently changes
  `desired_hours_per_week`, `identity_axis`, or `compounds` — those stay
  user-set. A rough week of execution (low Momentum, low completion_rate,
  a widened gap) can only reduce next week's *granted* allocation or shift
  *which axis goes first* — it can never rewrite what the person said their
  goal or axis assignment is. The gap mechanism changes ordering and
  quantity; it never touches the desired side of the equation.

---

## 6. What this deliberately leaves out

- **Time-of-day placement.** This engine outputs hours-per-commitment for
  the week, not a placed calendar. Placement stays manual (current BECOME
  behavior) until a separate placement pass is designed.
- **A long-horizon, user-facing compounding score.** `gap_smoothed` (§3) is
  an EMA, but it's a short-memory *input* used only to stabilize this
  week's allocation ordering — not the separately-discussed "compound % to
  desired identity," which would be a long-horizon (months), user-facing
  display metric with its own decay constant and its own purpose (showing
  progress, not deciding this week's hours). The two are structurally
  similar (both EMAs on identity-alignment signal) but serve different
  consumers and shouldn't share a time constant or a code path. This engine
  only ever answers "what's the budget for *this* week."
- **Cross-axis optimization beyond gap-ranked, largest-first ordering**
  (e.g. an ILP solver maximizing some global objective across axes
  simultaneously). Deliberately simple and greedy, same reasoning as
  everywhere else in this product: an auditable rule beats a clever black
  box.
- **Happiness/mood as a scoring input.** See §2.2 — considered and
  explicitly rejected.
- **Fame and Image as axes.** See §2.3 — the one exclusion made on ethical
  grounds rather than evidence-absence: research shows attaining these
  goals doesn't improve well-being, so the engine has no legitimate reason
  to help anyone allocate more week toward them.
- **A non-zero baseline on Achievement, Contribution, or Recreation.** Every
  axis carries the `baseline_hours_per_week` field now (v1.3), but the value
  is explicitly 0 for these three — Relationships/Finance/Foundation are the
  only ones with a specific, named research basis (need to belong; baseline
  financial security; physiological need) for treating part of them as
  non-negotiable. Giving the other three a made-up non-zero baseline just
  for symmetry would be re-inventing manual priority under a new name — the
  schema is uniform on purpose; the values aren't, also on purpose.
- **Foundation's internal flex distribution.** See §3's Step 4 note — how
  Foundation's own sub-constraints split its flex hours when Foundation
  wins the free pool is a real open detail, not designed yet.
