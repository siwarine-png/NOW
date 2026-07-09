# Adaptive Allocation Engine — MVP1 Spec

**Version:** v1.2
**Changelog from v1.1:** replaces the placeholder axis set in §2.3 with a
research-grounded spectrum — Aspiration Index (Kasser & Ryan) for the
competing "want" axes, Baumeister & Leary's need-to-belong finding for a new
**floor + flex** split on Relationships (and, by the same logic, Finance).
Adds Recreation as a sixth axis (included deliberately despite no direct
research backing — see §2.3). Explicitly and permanently excludes Fame and
Image as axes on ethical grounds: research shows pursuing them doesn't
improve wellbeing, so the engine has no business helping anyone chase them.
§3's Phase 1 now reserves floor hours for Relationships/Finance alongside
Foundation; Phase 2's axis-ask for those two axes only competes for the
*flex* portion above the floor.
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

### 2.1 Immutable constraints

Fixed categories that exist to keep the person healthy enough to do anything
else — sleep, meals, movement, hygiene, rest. Reused directly from BECOME's
existing `BLOCK_GUIDELINES`: each constraint has a `minDur`/`maxDur` and a
preferred time-of-day window.

```json
{
  "id": "b_found_n_sl",
  "label": "Sleep",
  "min_minutes": 420,
  "max_minutes": 540,
  "preferred_window": { "start_hour": 21, "end_hour": 23 }
}
```

**Rule:** immutable constraints can never be removed and can never be
allocated below `min_minutes`. They *can* shift in time or flex between
`min_minutes` and `max_minutes` — same "cannot remove, can adjust" framing
already decided for this product.

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

Net effect on the axis set:

| Axis | Type | Basis |
|---|---|---|
| **Foundation** | Need — fixed, never competes | Physiological/safety needs (Maslow's categories, as confirmed by Tay & Diener) |
| **Relationships** | Need floor + Want flex | Floor: Baumeister & Leary (belonging is a real need). Flex above floor: Aspiration Index's Affiliation |
| **Finance** | Need floor + Want flex | Floor: baseline financial security. Flex above floor: Aspiration Index's Wealth |
| **Achievement** | Want, competes | Aspiration Index's Personal Growth + Tay & Diener's Mastery/Respect/Autonomy |
| **Contribution** | Want, competes | Aspiration Index's Community |
| **Recreation** | Want, competes | **Not in either source above** — included anyway, deliberately, on a "better to have room for it than not" basis. Flagged honestly as the one axis without direct research backing. |

**Deliberately, permanently excluded: Fame and Image.** Not a research gap —
the opposite. This is the one place more coverage was considered and
rejected on purpose: Sheldon & Kasser's finding is that *attaining* these
goals doesn't improve well-being. Building an engine that helps someone
allocate more of their week toward chasing fame or image would mean
actively assisting a goal the evidence says doesn't help them, which fails
the same ethical bar that ruled out happiness/mood as a scoring input in
§2.2 — the engine should support what's actually good for the person, not
every possible want indiscriminately.

Six axes total (one fixed, five competing) — up from v1.1's three, but each
addition is either research-backed or an explicit, named exception, not
scope creep.

For each competing axis (Relationships/Finance additionally carry a floor,
see §3):

```json
{
  "axis": "achievement",
  "desired_hours_per_week": 32,
  "current_hours_per_week": 18.5,
  "gap_raw": 13.5,
  "gap_smoothed": 9.2
}
```

```json
{
  "axis": "relationships",
  "floor_hours_per_week": 3,
  "desired_hours_per_week": 18,
  "current_hours_per_week": 12,
  "gap_raw": 6,
  "gap_smoothed": 4.1
}
```

- `desired_hours_per_week` — sum of `target_hours_per_week` across all active
  commitments tagged to this axis. User-set, same as v1.1 — the engine never
  invents what you want.
- `current_hours_per_week` — **measured**, not self-assessed: trailing actual
  hours completed on this axis's commitments (same source data as
  `completion_rate`, aggregated per axis instead of per commitment).
- `floor_hours_per_week` — **Relationships and Finance only.** A
  non-negotiable minimum, reserved in Phase 1 alongside Foundation (§3) —
  same "cannot remove, can exceed" framing as immutable constraints, just
  applied to a want-axis's baseline instead of a physiological one.
- `gap_raw = desired − current`, floored at 0 (over-delivering on an axis
  isn't a debt the engine tracks or "spends down" elsewhere).
- `gap_smoothed` — see §3; this is the value actually used for weighting,
  not `gap_raw`.

---

## 3. Allocation algorithm

Two phases, both deterministic — no ML/LLM in this path, same founding
principle as the other two engines.

### Phase 1 — Reserve constraints and floors

```
committed_hours = Σ (constraint.min_minutes / 60) for all immutable constraints
                + relationships.floor_hours_per_week
                + finance.floor_hours_per_week
free_pool = 168 − committed_hours
```

Constraints are reserved at their *minimum*, not their maximum — the
remainder up to `max_minutes` is available discretionary buffer, not
pre-committed, so it doesn't starve the free pool by default. Relationships'
and Finance's floors are reserved in full here, same as Foundation — they
are guaranteed before anything else is distributed, not something that has
to win a gap-ranking contest.

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

**Step 2 — rank axes by `gap_smoothed`, largest first.** This is the
cross-axis ordering that used to be the manual `priority` field: the axis
you've most under-delivered on relative to your own stated goal claims the
free pool first.

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
           minus floor_hours_per_week (Relationships/Finance only — already reserved in Phase 1)
if axis_ask <= free_pool:
    grant each commitment its full target_hours_per_week (minus its share of the floor, already covered)
else:
    grant each commitment target_hours_per_week × (weight / Σ weights on this axis) × (free_pool / axis_ask)
free_pool -= Σ granted this axis
```

For Relationships and Finance, the floor is never re-litigated here — it's
already spent in Phase 1. This step only ever fights over the *flex* portion
above it, so a bad week can shrink how much *extra* relationship or
financial time gets granted, but never eats into the guaranteed floor
itself.

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
  "floors_reserved": { "relationships": 3, "finance": 2 },
  "axis_order": [
    { "axis": "achievement", "gap_smoothed": 9.2 },
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
- **A floor on Achievement, Contribution, or Recreation.** Only
  Relationships and Finance got the floor+flex treatment, because those are
  the only two with a specific, named research basis (need to belong;
  baseline financial security) for treating part of them as non-negotiable.
  Extending floors to the other axes without equivalent justification would
  just be re-inventing manual priority under a new name.
