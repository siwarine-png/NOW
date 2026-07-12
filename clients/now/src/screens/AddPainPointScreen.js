/**
 * "Something new to track" — reached via the secondary link at the bottom
 * of StuckScreen (the "I'm Stuck" tab's primary action is now a momentary
 * unsticking triage, not this).
 *
 * No preset options anymore (the old "Remembering medicine" button is
 * gone) -- straight to a blank input with a short guiding hint, since a
 * fixed list of presets implicitly narrows what people think they're
 * "allowed" to type. Medication reminders specifically still exist, just
 * via the Adaptive Nudge Engine's own reuse flow in Settings ("Remind me
 * to take medication"), which is the actually-adherence-aware path for
 * that -- this screen is only ever the 6-axis want/need spectrum now.
 *
 * The kind picker sits right on the title screen, between the input and
 * Continue -- not a separate step, so choosing a title and choosing what
 * KIND of thing it is happen on one screen instead of costing an extra
 * screen transition. Continue is disabled until both are set. What KIND of
 * thing this is decides the whole shape of what follows (does it even need
 * a time? a due date? a sequence of steps?), which of the 6 axes it
 * belongs to doesn't, so axis is still asked afterward, separately. Five
 * genuinely different structures, not five labels on the same shape:
 *  - Task, with a due time/date: date -> time -> deadline flow, cadence
 *    forced to 'once'. "Right now, can't wait" (priority_tier: 'critical',
 *    no window at all) lives as a chip on the date screen rather than its
 *    own gate first -- it's still due "now," just with a different shape
 *    once picked (see submitUrgent). due_date (migration 025) is
 *    the actual calendar date, separate from window_start/window_end
 *    (which are just a time-of-day, no date of their own) -- without it, a
 *    task scheduled for a specific future day had no way to say so and
 *    would nag every day at that time forever instead of just its one day.
 *  - Task, no due date: submits immediately after axis is picked -- no
 *    time, no urgency, no deadline. Genuinely open-ended ("someday, not
 *    scheduled") is a real, common shape that forcing a time onto
 *    previously had no path for.
 *  - Habit: recurring behavior -- daily/monthly cadence, a plain
 *    time-of-day, no urgency or deadline framing (neither fits something
 *    recurring).
 *  - Project: an ongoing outcome with multiple steps -- an open loop (add
 *    step, add another, or that's all of them) that creates one parent
 *    commitment plus its steps as children (parent_commitment_id, first
 *    step 'active', the rest 'paused'), same decomposition mechanic Day
 *    Arc's checklist uses (see engine/decomposition.js). Before this there
 *    was no way to create an actual multi-step project through the UI at
 *    all -- Day Arc only exists because it was hand-seeded via SQL.
 *  - Event: something you attend, not something you do -- no urgency
 *    question, no start-vs-deadline framing (an appointment just HAS a
 *    time), and is_fixed: true (migration 026) exempts it from R4's "define
 *    your first physical step" and R8's "this has gone stale" nags, neither
 *    of which make sense for an appointment. One time goes through the same
 *    date step task_due uses (minus the "right now, can't wait" chip -- an
 *    appointment already has a schedule by definition); "it repeats" reuses
 *    the same recurrence picker habits use (daily/weekly/monthly).
 *
 * STEP_AXIS tags the new commitment with an Adaptive Allocation Engine
 * identity_axis (migration 016) -- one tap, no typing.
 *
 * A recurring behavior anchored to something relative rather than a clock
 * time (medication "after breakfast/after lunch") isn't handled by the
 * Habit path here at all -- it needs actual experimentation to find the
 * real trigger moment, which is what the Adaptive Nudge Engine's separate
 * "Remind me to take medication" flow (Settings) already does, tested
 * against real anchors instead of guessing a fixed clock time. Route that
 * case there, not through this screen.
 */
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { createCommitment, getStalledProjects } from '../api/engine';
import { showAlert } from '../utils/alert';

const STEP_CHECKING = -1;
const STEP_STALE_NUDGE = -2;
const STEP_TITLE = 0;
const STEP_AXIS = 1;
const STEP_RECURRENCE = 3;
const STEP_DATE = 7;
const STEP_TIME = 4;
const STEP_TIME_MEANING = 5;
const STEP_DURATION = 6;
const STEP_PROJECT_STEP = 8;
const STEP_EVENT_TYPE = 9;

const DURATIONS = [
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
];

const KIND_OPTIONS = [
  { value: 'task_due', label: 'Task (due)' },
  { value: 'task_no_due', label: 'Task (someday)' },
  { value: 'habit', label: 'Habit' },
  { value: 'project', label: 'Project' },
  { value: 'event', label: 'Event' },
];

const AXES = [
  { key: 'foundation', label: 'Foundation' },
  { key: 'relationships', label: 'Relationships' },
  { key: 'achievement', label: 'Achievement' },
  { key: 'finance', label: 'Finance' },
  { key: 'contribution', label: 'Contribution' },
  { key: 'recreation', label: 'Recreation' },
];

function addMinutesToTime(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = ((h * 60 + m + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function defaultTime() {
  const d = new Date();
  const roundedMin = d.getMinutes() < 30 ? 30 : 0;
  const hour = (d.getMinutes() < 30 ? d.getHours() : d.getHours() + 1) % 24;
  return `${String(hour).padStart(2, '0')}:${String(roundedMin).padStart(2, '0')}`;
}

function normalizeTime(raw) {
  if (!raw) return raw;
  if (raw.includes(':')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return raw;
  const hours = Math.min(parseInt(digits.length <= 2 ? digits : digits.slice(0, -2), 10) || 0, 23);
  const mins = Math.min(digits.length <= 2 ? 0 : parseInt(digits.slice(-2), 10) || 0, 59);
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function formatDisplayTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// YYYY-MM-DD in the device's own local calendar -- deliberately not
// toISOString() (that's UTC and can land on the wrong day near midnight),
// matches the plain `date` column due_date is stored as (migration 025).
function dateToKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayDateKey() {
  return dateToKey(new Date());
}

function addDaysDateKey(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dateToKey(d);
}

// Accepts "7/20" or "7/20/2027" -- no year assumes the next upcoming
// occurrence of that month/day (today counts as upcoming), since typing a
// year for something happening this year is friction nobody wants.
function parseDateInput(raw) {
  if (!raw?.trim()) return null;
  const parts = raw.trim().split('/').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const month = Math.min(Math.max(parseInt(parts[0], 10) || 0, 1), 12);
  const day = Math.min(Math.max(parseInt(parts[1], 10) || 0, 1), 31);
  let year = parts[2] ? parseInt(parts[2], 10) : new Date().getFullYear();
  if (parts[2] && parts[2].length <= 2) year += 2000;
  let d = new Date(year, month - 1, day);
  if (!parts[2]) {
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
    if (d < todayMidnight) d = new Date(year + 1, month - 1, day);
  }
  return dateToKey(d);
}

function formatDisplayDate(dateKey) {
  if (!dateKey) return '';
  if (dateKey === todayDateKey()) return 'Today';
  if (dateKey === addDaysDateKey(1)) return 'Tomorrow';
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// secondaryActionLabel/onSecondaryAction: optional, shown only on the blank
// STEP_TITLE screen -- used by OnboardingScreen's day-1 "add as many real
// things as apply to you, or nothing at all" open loop (see its own header
// comment) to offer an explicit way out at exactly the point where someone
// either has nothing more to add, or nothing to begin with. Normal usage
// from the New tab doesn't pass these and renders exactly as before.
export default function AddPainPointScreen({ user, onCreated, secondaryActionLabel, onSecondaryAction }) {
  const [step, setStep] = useState(STEP_CHECKING);
  const [staleProjects, setStaleProjects] = useState([]);
  const [customTitle, setCustomTitle] = useState('');
  const [identityAxis, setIdentityAxis] = useState(null);
  const [cadence, setCadence] = useState('daily');
  const [time, setTime] = useState(defaultTime());
  const [pickingTime, setPickingTime] = useState(false);
  const [customTime, setCustomTime] = useState('');
  const [dueDate, setDueDate] = useState(todayDateKey());
  const [pickingDate, setPickingDate] = useState(false);
  const [customDateInput, setCustomDateInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [itemKind, setItemKind] = useState(null); // 'task' | 'habit' | 'project'
  const [projectSteps, setProjectSteps] = useState([]);
  const [currentStepInput, setCurrentStepInput] = useState('');
  const stepInputRef = useRef(null);

  // Soft nudge, not a gate -- every path out of here (including a failed
  // check) lands on the normal STEP_TITLE flow; this only ever adds one
  // extra screen in front of it, never blocks adding something new.
  useEffect(() => {
    if (!user?.id) { setStep(STEP_TITLE); return; }
    getStalledProjects(user.id)
      .then(({ stalled }) => {
        setStaleProjects(stalled || []);
        setStep(stalled?.length ? STEP_STALE_NUDGE : STEP_TITLE);
      })
      .catch(() => setStep(STEP_TITLE));
  }, [user?.id]);

  // Both title and kind live on the same screen now, so Continue can't fire
  // until both are set -- the kind chips are just a setItemKind, no
  // transition of their own (see selectKind).
  function continueFromTitle() {
    if (!customTitle.trim() || !itemKind) return;
    if (itemKind === 'task_due' || itemKind === 'task_no_due') setCadence('once');
    setStep(STEP_AXIS);
  }

  function selectKind(kind) {
    setItemKind(kind);
  }

  // Axis picked, now branch by the kind chosen a moment ago. task_no_due
  // submits immediately from here -- axisKey is passed straight through
  // rather than read from identityAxis state, since that state update
  // hasn't committed yet within this same tap. task_due goes straight to
  // the date step now -- "right now, can't wait" lives as a chip there
  // instead of costing its own separate screen first (see STEP_DATE).
  function chooseAxis(axisKey) {
    setIdentityAxis(axisKey);
    if (itemKind === 'task_due') setStep(STEP_DATE);
    else if (itemKind === 'task_no_due') createAndReset({}, axisKey);
    else if (itemKind === 'habit') setStep(STEP_RECURRENCE);
    else if (itemKind === 'event') setStep(STEP_EVENT_TYPE);
    else {
      setProjectSteps([]);
      setCurrentStepInput('');
      setStep(STEP_PROJECT_STEP);
    }
  }

  // "One time" goes straight to the date step (shared with task_due, minus
  // its "right now, can't wait" chip -- an appointment already has a
  // schedule by definition, there's no "can't wait, no schedule" mode for
  // it). "It repeats" goes to the same recurrence picker habits use.
  function chooseEventType(recurring) {
    if (recurring) setStep(STEP_RECURRENCE);
    else { setCadence('once'); setStep(STEP_DATE); }
  }

  function chooseCadence(value) {
    setCadence(value);
    setStep(STEP_TIME);
  }

  function chooseDate(dateKey) {
    setDueDate(dateKey);
    setPickingDate(false);
    setCustomDateInput('');
    setStep(STEP_TIME);
  }

  // Habits and events both skip the "start time vs deadline" question
  // entirely (neither framing fits something recurring, and an appointment
  // just HAS a time, it doesn't "start around" or "deadline" toward one)
  // and submit directly; tasks continue to STEP_TIME_MEANING as before.
  function continueFromTime(t) {
    setTime(t);
    if (itemKind === 'habit' || itemKind === 'event') submit(t);
    else setStep(STEP_TIME_MEANING);
  }

  function handleCustomTimeChange(text) {
    const digits = text.replace(/\D/g, '').slice(0, 4);
    setCustomTime(digits.length <= 2 ? digits : `${digits.slice(0, -2)}:${digits.slice(-2)}`);
  }

  // Clearing the input's value alone doesn't keep focus on web -- without
  // the explicit refocus, every single step meant a manual re-tap into the
  // field just to keep typing the next one, exactly the friction a
  // "keep typing, one thing after another" flow shouldn't have.
  function addProjectStep() {
    if (!currentStepInput.trim()) return;
    setProjectSteps(steps => [...steps, currentStepInput.trim()]);
    setCurrentStepInput('');
    stepInputRef.current?.focus();
  }

  // Creates one parent commitment (the project itself) then each step as a
  // child under it -- first step 'active' (surfaceable right away), the
  // rest 'paused' (queued), same shape Day Arc's checklist uses. The
  // engine auto-advances the chain as each step is finished or removed
  // (engine/decomposition.js) -- nothing extra needed here for that part.
  async function finishProject() {
    const steps = currentStepInput.trim() ? [...projectSteps, currentStepInput.trim()] : projectSteps;
    if (!steps.length || !user?.id) return;
    setLoading(true);
    try {
      const parent = await createCommitment({
        user_id: user.id, title: customTitle.trim(), next_action: 'Work the current step below.',
        cadence: 'once', identity_axis: identityAxis, priority_tier: 'normal',
      });
      for (let i = 0; i < steps.length; i++) {
        // A project's own steps are typed one physical action at a time
        // (STEP_PROJECT_STEP's "what's the first/next step?") -- that IS
        // the next_action, not something to ask again later. Leaving this
        // null was making R4_ambiguous_action re-ask "define your first
        // physical step" for a step the user just explicitly wrote out.
        await createCommitment({
          user_id: user.id, parent_commitment_id: parent.id, title: steps[i], next_action: steps[i],
          cadence: 'once', identity_axis: identityAxis, priority_tier: 'normal',
          status: i === 0 ? 'active' : 'paused',
        });
      }
      resetAll();
      onCreated?.();
    } catch (e) {
      showAlert("Couldn't add that", e.message);
    } finally {
      setLoading(false);
    }
  }

  function resetAll() {
    setStep(STEP_TITLE);
    setCustomTitle('');
    setIdentityAxis(null);
    setCadence('daily');
    setPickingTime(false);
    setCustomTime('');
    setTime(defaultTime());
    setDueDate(todayDateKey());
    setPickingDate(false);
    setCustomDateInput('');
    setItemKind(null);
    setProjectSteps([]);
    setCurrentStepInput('');
  }

  // axisOverride: only needed by task_no_due's immediate submit from
  // chooseAxis, where identityAxis state hasn't committed yet within the
  // same tap -- every other caller relies on identityAxis already being
  // settled by the time it runs.
  //
  // next_action defaults to the title itself -- for a quick task/habit,
  // whatever was typed on the title screen already IS the one concrete
  // thing to do (that's the whole question that screen asks). Leaving this
  // null made R4_ambiguous_action ask "what's the first physical step?"
  // again for something the user had just already stated, every single
  // time, for every task/habit created this way. Still overridable via
  // payload if a caller ever needs something more specific than the title.
  async function createAndReset(payload, axisOverride) {
    if (!user?.id) return;
    setLoading(true);
    try {
      await createCommitment({
        user_id: user.id, title: customTitle.trim(), next_action: customTitle.trim(),
        cadence, priority_tier: 'normal', identity_axis: axisOverride ?? identityAxis,
        ...payload,
      });
      resetAll();
      onCreated?.();
    } catch (e) {
      showAlert("Couldn't add that", e.message);
    } finally {
      setLoading(false);
    }
  }

  // "Right now" skips scheduling entirely -- priority_tier: 'critical' is
  // the same mechanism a medication reminder uses (R9_critical_override,
  // engine/src/engine/rules.js): it always surfaces first on NOW, ahead of
  // the domain rotation and everything else, checked before either. No
  // window_start means the rule matches immediately regardless of time of
  // day, which is exactly "can't wait" -- asking for a scheduled time here
  // would be friction against the thing that was just declared urgent.
  function submitUrgent() {
    return createAndReset({ cadence: 'once', priority_tier: 'critical', window_start: null, window_end: null });
  }

  // {time} is when to start — the plain "we'll nudge you around then" case.
  // due_date only applies to task_due and a one-time event (cadence
  // 'once') -- a recurring event or habit has no specific calendar date,
  // just a time-of-day. is_fixed marks an event as external/fixed time
  // (see migration 026) -- exempts it from R4/R8's task-oriented nags,
  // since an appointment has no "first physical step" and doesn't go
  // stale the way a neglected task does.
  function submit(finalTime) {
    return createAndReset({
      window_start: finalTime, window_end: addMinutesToTime(finalTime, 60),
      ...(itemKind === 'task_due' ? { due_date: dueDate } : {}),
      ...(itemKind === 'event' ? { is_fixed: true, ...(cadence === 'once' ? { due_date: dueDate } : {}) } : {}),
    });
  }

  // {deadlineTime} is when it must be DONE by, not when to start -- back the
  // notification off by the estimated duration so there's actually enough
  // time left to finish, instead of nudging at the deadline itself. Only
  // ever reached via task_due's own flow (STEP_TIME_MEANING -> STEP_DURATION),
  // so due_date is always set by now -- built from the actually-picked date
  // (STEP_DATE), not just assumed to be today.
  function submitWithDeadline(deadlineTime, durationMinutes) {
    const startTime = addMinutesToTime(deadlineTime, -durationMinutes);
    const [dh, dm] = deadlineTime.split(':').map(Number);
    const [dy, dmo, dd] = dueDate.split('-').map(Number);
    const deadlineDate = new Date(dy, dmo - 1, dd, dh, dm, 0, 0);
    return createAndReset({
      window_start: startTime, window_end: deadlineTime,
      deadline: deadlineDate.toISOString(), due_date: dueDate,
    });
  }

  if (step === STEP_CHECKING) return (
    <View style={s.center}><ActivityIndicator color="#6366f1" /></View>
  );

  if (step === STEP_STALE_NUDGE) return (
    <View style={s.center}>
      <Text style={s.title}>Before adding{'\n'}something new...</Text>
      <Text style={s.hint}>These haven't moved in a while:</Text>
      <View style={s.staleList}>
        {staleProjects.map(p => (
          <View key={p.commitment_id} style={s.staleRow}>
            <Text style={s.staleTitle}>{p.title}</Text>
            <Text style={s.staleDays}>quiet {p.days_stalled}d</Text>
          </View>
        ))}
      </View>
      <TouchableOpacity style={s.btn} onPress={() => setStep(STEP_TITLE)}>
        <Text style={s.btnText}>Continue anyway →</Text>
      </TouchableOpacity>
    </View>
  );

  if (step === STEP_AXIS) return (
    <View style={s.center}>
      <Text style={s.title}>Which part of your life{'\n'}does this belong to?</Text>
      <View style={s.chipGrid}>
        {AXES.map(a => (
          <TouchableOpacity key={a.key} style={s.chip} disabled={loading} onPress={() => chooseAxis(a.key)}>
            <Text style={s.chipText}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {/* Only task_no_due submits immediately from this screen (see
          chooseAxis) -- everyone else just moves on to the next step, so
          this spinner only ever appears for that one path. */}
      {loading && <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} />}
    </View>
  );

  // "Right now, can't wait" used to be its own screen (STEP_URGENCY) before
  // every task_due task -- an extra gate before getting to the date you'd
  // already implied by picking "due." It's really just one more option on
  // this same screen: still the same different shape underneath
  // (priority_tier: 'critical', no window at all, see submitUrgent), just
  // reached without a whole separate step first.
  if (step === STEP_DATE) return (
    <View style={s.center}>
      <Text style={s.title}>{itemKind === 'event' ? 'What day\nis this?' : 'What day\nis this due?'}</Text>
      <Text style={s.hint}>We'll ask what time next.</Text>

      {!pickingDate ? (
        <>
          {/* "Right now, can't wait" only makes sense for a task -- a
              one-time event already has a definite schedule by nature,
              there's no "no schedule, just do it now" mode for it. */}
          {itemKind === 'task_due' && (
            <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} disabled={loading} onPress={submitUrgent}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Right now — can't wait</Text>}
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={() => chooseDate(todayDateKey())} disabled={loading}>
            <Text style={s.btnText}>Today</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={() => chooseDate(addDaysDateKey(1))} disabled={loading}>
            <Text style={s.btnText}>Tomorrow</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.linkBtn} onPress={() => setPickingDate(true)} disabled={loading}>
            <Text style={s.linkBtnText}>Pick a specific date</Text>
          </TouchableOpacity>
        </>
      ) : Platform.OS === 'web' ? (
        // A real calendar picker (the browser's own) instead of typed
        // "7/20" text -- no native equivalent installed for iOS/Android
        // yet (would need its own library and a native rebuild, not just
        // a web deploy), so those keep the typed fallback below.
        <>
          <input
            type="date"
            value={customDateInput}
            min={todayDateKey()}
            onChange={e => setCustomDateInput(e.target.value)}
            style={webDateInputStyle}
          />
          <TouchableOpacity
            style={[s.btn, !customDateInput && s.btnDisabled]}
            disabled={!customDateInput}
            onPress={() => chooseDate(customDateInput)}
          >
            <Text style={s.btnText}>Set and continue →</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <TextInput
            style={s.input} value={customDateInput} onChangeText={setCustomDateInput}
            keyboardType="numbers-and-punctuation" placeholder="e.g. 7/20 for July 20" placeholderTextColor="#475569" autoFocus
            onSubmitEditing={() => chooseDate(parseDateInput(customDateInput) || dueDate)} returnKeyType="next"
          />
          <TouchableOpacity
            style={s.btn}
            onPress={() => chooseDate(parseDateInput(customDateInput) || dueDate)}
          >
            <Text style={s.btnText}>Set and continue →</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  if (step === STEP_PROJECT_STEP) return (
    <View style={s.center}>
      <Text style={s.title}>{projectSteps.length === 0 ? "What's the first step?" : 'Next step?'}</Text>
      <Text style={s.hint}>{projectSteps.length > 0 ? `${projectSteps.length} step${projectSteps.length === 1 ? '' : 's'} so far` : 'One step at a time.'}</Text>

      {projectSteps.length > 0 && (
        <View style={s.staleList}>
          {projectSteps.map((stepTitle, i) => (
            <View key={i} style={s.staleRow}>
              <Text style={s.staleTitle}>{i + 1}. {stepTitle}</Text>
            </View>
          ))}
        </View>
      )}

      <TextInput
        ref={stepInputRef}
        style={s.input} value={currentStepInput} onChangeText={setCurrentStepInput}
        placeholder="e.g. export the PDF" placeholderTextColor="#475569" autoFocus
        onSubmitEditing={addProjectStep} returnKeyType="next"
      />
      <TouchableOpacity
        style={[s.btn, !currentStepInput.trim() && s.btnDisabled]} disabled={!currentStepInput.trim() || loading}
        onPress={addProjectStep}
      >
        <Text style={s.btnText}>Add step →</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={s.linkBtn}
        disabled={loading || (!projectSteps.length && !currentStepInput.trim())}
        onPress={finishProject}
      >
        <Text style={s.linkBtnText}>{loading ? 'Creating…' : "That's all the steps →"}</Text>
      </TouchableOpacity>
    </View>
  );

  if (step === STEP_EVENT_TYPE) return (
    <View style={s.center}>
      <Text style={s.title}>Is this{'\n'}one time, or does it repeat?</Text>
      <TouchableOpacity style={s.btn} onPress={() => chooseEventType(false)}>
        <Text style={s.btnText}>One time</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={() => chooseEventType(true)}>
        <Text style={s.btnText}>It repeats</Text>
      </TouchableOpacity>
    </View>
  );

  if (step === STEP_RECURRENCE) return (
    <View style={s.center}>
      <Text style={s.title}>How often{'\n'}will you do this?</Text>
      <TouchableOpacity style={s.btn} onPress={() => chooseCadence('daily')}>
        <Text style={s.btnText}>Every day</Text>
      </TouchableOpacity>
      {/* Weekly existed in the cadence column's own CHECK constraint from
          the start but was never actually offered anywhere until a
          recurring Event needed it (stats.js's period math now handles it
          too -- see migration history). */}
      <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={() => chooseCadence('weekly')}>
        <Text style={s.btnText}>Every week</Text>
      </TouchableOpacity>
      {/* Without this, something genuinely monthly (e.g. "send provision
          budget to sister") had no correct option and defaulted to 'daily' --
          nagging every single day instead of going quiet once done until
          next month. Reuses the same time-of-day question below; 'monthly'
          just changes when it resets (see stats.js's cadence-aware period). */}
      <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={() => chooseCadence('monthly')}>
        <Text style={s.btnText}>Once a month</Text>
      </TouchableOpacity>
    </View>
  );

  if (step === STEP_TIME) return (
    <View style={s.center}>
      <Text style={s.title}>What time{'\n'}are we talking about?{'\n'}{formatDisplayTime(time)}</Text>
      <Text style={s.hint}>
        {(itemKind === 'task_due' || (itemKind === 'event' && cadence === 'once')) ? `${formatDisplayDate(dueDate)}. Good?` : 'Good?'}
      </Text>

      {!pickingTime ? (
        <>
          <TouchableOpacity style={s.btn} onPress={() => continueFromTime(time)}>
            <Text style={s.btnText}>Sounds good →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.linkBtn} onPress={() => setPickingTime(true)}>
            <Text style={s.linkBtnText}>Pick a different time</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <TextInput
            style={s.input} value={customTime} onChangeText={handleCustomTimeChange}
            keyboardType="number-pad" placeholder="e.g. 1830 for 6:30 PM" placeholderTextColor="#475569" autoFocus
          />
          <TouchableOpacity
            style={s.btn}
            onPress={() => continueFromTime(normalizeTime(customTime.trim()) || time)}
          >
            <Text style={s.btnText}>Set and continue →</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  // Does {time} mean "start around then" or "must be DONE by then"? These
  // need very different scheduling: a deadline has to back the actual nudge
  // off by however long the thing takes, or it fires too late to be useful
  // (see submitWithDeadline).
  if (step === STEP_TIME_MEANING) return (
    <View style={s.center}>
      <Text style={s.title}>Is {formatDisplayTime(time)}{'\n'}when you'll start —{'\n'}or the deadline to finish by?</Text>
      <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} disabled={loading} onPress={() => submit(time)}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>I'll start around then</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={() => setStep(STEP_DURATION)} disabled={loading}>
        <Text style={s.btnText}>Must be done by then</Text>
      </TouchableOpacity>
    </View>
  );

  if (step === STEP_DURATION) return (
    <View style={s.center}>
      <Text style={s.title}>About how long{'\n'}will it take?</Text>
      <Text style={s.hint}>We'll nudge you with enough time left before {formatDisplayTime(time)}.</Text>
      <View style={s.chipGrid}>
        {DURATIONS.map(d => (
          <TouchableOpacity key={d.minutes} style={s.chip} disabled={loading} onPress={() => submitWithDeadline(time, d.minutes)}>
            <Text style={s.chipText}>{d.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <View style={s.center}>
      <Text style={s.title}>What's the one thing{'\n'}you want help with{'\n'}right now?</Text>
      <Text style={s.hint}>Big or small — whatever's actually on your mind.</Text>

      <TextInput
        style={s.input} value={customTitle} onChangeText={setCustomTitle}
        placeholder="e.g. finishing my taxes" placeholderTextColor="#475569" autoFocus
        onSubmitEditing={continueFromTitle} returnKeyType="next"
      />

      <View style={s.kindChipRow}>
        {KIND_OPTIONS.map(k => (
          <TouchableOpacity
            key={k.value}
            style={[s.kindChip, itemKind === k.value && s.kindChipSelected]}
            onPress={() => selectKind(k.value)}
          >
            <Text style={[s.kindChipText, itemKind === k.value && s.kindChipTextSelected]}>{k.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[s.btn, (!customTitle.trim() || !itemKind) && s.btnDisabled]} disabled={!customTitle.trim() || !itemKind}
        onPress={continueFromTitle}
      >
        <Text style={s.btnText}>Continue →</Text>
      </TouchableOpacity>
      {onSecondaryAction && (
        <TouchableOpacity style={s.linkBtn} onPress={onSecondaryAction}>
          <Text style={s.linkBtnText}>{secondaryActionLabel || "That's it for now →"}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// A raw HTML element (react-native-web renders it straight through), so it
// takes real CSS inline styles, not a StyleSheet entry -- roughly matching
// s.input's look, though the browser still owns the calendar icon/popup
// itself and won't take every property (e.g. no real text-align control).
const webDateInputStyle = {
  backgroundColor: '#1e293b', borderRadius: 10, padding: 14, fontSize: 16, color: '#f1f5f9',
  marginBottom: 16, border: '1px solid #334155', width: 240, colorScheme: 'dark',
};

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center', padding: 28 },
  title: { fontSize: 26, fontWeight: '900', color: '#fff', textAlign: 'center', lineHeight: 34, marginBottom: 8 },
  hint: { fontSize: 15, color: '#64748b', marginBottom: 32, textAlign: 'center' },
  input: { backgroundColor: '#1e293b', borderRadius: 10, padding: 14, fontSize: 16, color: '#f1f5f9', marginBottom: 16, borderWidth: 1, borderColor: '#334155', width: 240, textAlign: 'center' },
  btn: { backgroundColor: '#6366f1', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 10, minWidth: 220 },
  btnSecondary: { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  kindChipRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, maxWidth: 260, marginBottom: 6 },
  kindChip: { backgroundColor: '#1e293b', borderRadius: 16, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: '#334155' },
  kindChipSelected: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  kindChipText: { color: '#f1f5f9', fontSize: 13, fontWeight: '600' },
  kindChipTextSelected: { color: '#fff' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  linkBtn: { paddingVertical: 14 },
  linkBtnText: { color: '#6366f1', fontSize: 14, fontWeight: '700' },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, maxWidth: 340 },
  chip: { backgroundColor: '#1e293b', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1, borderColor: '#334155' },
  chipText: { color: '#f1f5f9', fontSize: 14, fontWeight: '600' },
  staleList: { width: '100%', maxWidth: 300, marginBottom: 24 },
  staleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  staleTitle: { color: '#f1f5f9', fontSize: 14, fontWeight: '700', flex: 1, marginRight: 10 },
  staleDays: { color: '#f59e0b', fontSize: 12, fontWeight: '700' },
});
