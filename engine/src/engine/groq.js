/**
 * Groq-assisted activity classification -- the one deliberate, narrow
 * exception to "no ML/LLM in the intervention path" (adaptive-allocation-
 * engine spec's founding principles). This only *suggests* which of the 6
 * already-real axes a freely-described activity belongs to, plus whether it
 * sounds like fixed/non-negotiable time or flexible/discretionary time
 * ("I'm developing DESIRED -- achievement or finance? fixed or free?"); it
 * never invents whether something happened, and the client still requires
 * an explicit Accept tap before anything is recorded -- identical to
 * picking a chip manually.
 *
 * response_format's strict/enum-constrained decoding only works reliably on
 * the openai/gpt-oss-* models on Groq (other models on the platform silently
 * ignore the json_schema constraint), so the model is pinned here rather
 * than left configurable.
 */
const { AXES } = require('./identityCheckin');

const GROQ_MODEL = 'openai/gpt-oss-20b';

async function classifyActivity(freeText) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');

  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You classify one short description of what someone is currently doing into exactly one of six life axes: ' +
            'foundation (sleep, meals, movement, health basics), relationships (family, friends, partner), ' +
            'achievement (career, learning, building or creating things), finance (money, income, budgeting), ' +
            'contribution (helping others, community, volunteering), recreation (rest, fun, hobbies with no other goal). ' +
            'Pick the single best fit. If an activity could serve multiple axes, pick the one it most directly builds toward. ' +
            'Also decide whether this is fixed time (a non-negotiable obligation they can\'t reschedule or skip, e.g. a work ' +
            'shift, a scheduled meeting, childcare duty) or flexible time (discretionary -- they chose to spend it this way ' +
            'and could have done something else instead).',
        },
        { role: 'user', content: freeText.slice(0, 300) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'activity_classification',
          schema: {
            type: 'object',
            properties: {
              axis: { type: 'string', enum: AXES },
              is_fixed: { type: 'boolean' },
            },
            required: ['axis', 'is_fixed'],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  if (!resp.ok) throw new Error(`Groq request failed: ${resp.status}`);
  const data = await resp.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  if (!AXES.includes(parsed.axis)) throw new Error('Groq returned an invalid axis');
  if (typeof parsed.is_fixed !== 'boolean') throw new Error('Groq returned an invalid is_fixed');
  return { axis: parsed.axis, is_fixed: parsed.is_fixed };
}

// HatchEm's opt-in "Analyze" -- the second deliberate, narrow exception to
// "no ML/LLM in the core loop." Purely descriptive/read-only: it looks at
// a batch of currently-incubating thoughts and surfaces thematic clusters
// plus possible semantic duplicates (the fuzzy-matching findRepeat() in
// hatchem.html can't do with exact-text matching alone -- see its own
// header comment). It never decides anything on the user's behalf --
// hatch/rest stays a human-only three-button decision in the weekly
// check-in, same as before. Deliberately excluded from the schema:
// anything resembling a recommendation ("hatch this," "this is your best
// idea") -- descriptive observations only, consistent with the rest of
// this app never handing down a verdict.
//
// This is the one place HatchEm's captured text leaves the device at all,
// and only because the user explicitly opted in (see hatchem.html's
// aiOptIn flag, off by default) -- everything else about HatchEm stays
// local-only.
const ANALYZE_MODEL = 'openai/gpt-oss-20b';

async function analyzeThoughts(items) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');
  if (!Array.isArray(items) || !items.length) throw new Error('items required');

  const numbered = items
    .map((it, i) => `${i}. [${it.category || 'Idea'}] ${String(it.text || '').slice(0, 280)}`)
    .join('\n');

  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: ANALYZE_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are looking at a numbered list of short thoughts someone captured in a brain-dump tool -- a mix of ' +
            'ideas, random thoughts, and worries. Find two things, purely descriptively, never prescriptively: ' +
            '(1) clusters -- groups of 2 or more thoughts that relate to the same underlying theme or project, with a ' +
            'short (under 6 words) neutral theme label; (2) duplicates -- pairs or groups of thoughts that are likely ' +
            'the SAME underlying thought worded differently (not just the same category), with a short reason. ' +
            'Reference thoughts ONLY by their number. Never recommend what to do with any thought (never say something ' +
            'should be hatched, kept, or dropped) -- observations only. Also write one short (under 200 characters) ' +
            'overall note about the pattern across all of them, or an empty string if nothing stands out. If there are ' +
            'no clusters or no duplicates, return empty arrays for those -- do not force a match that isn\'t there.',
        },
        { role: 'user', content: numbered },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'thought_analysis',
          schema: {
            type: 'object',
            properties: {
              clusters: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    theme: { type: 'string' },
                    idea_indexes: { type: 'array', items: { type: 'integer' } },
                  },
                  required: ['theme', 'idea_indexes'],
                  additionalProperties: false,
                },
              },
              duplicates: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    idea_indexes: { type: 'array', items: { type: 'integer' } },
                    reason: { type: 'string' },
                  },
                  required: ['idea_indexes', 'reason'],
                  additionalProperties: false,
                },
              },
              note: { type: 'string' },
            },
            required: ['clusters', 'duplicates', 'note'],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  if (!resp.ok) throw new Error(`Groq request failed: ${resp.status}`);
  const data = await resp.json();
  const parsed = JSON.parse(data.choices[0].message.content);

  var n = items.length;
  function validIndexes(arr) {
    return Array.isArray(arr) && arr.every(function (i) { return Number.isInteger(i) && i >= 0 && i < n; });
  }
  var clusters = (parsed.clusters || []).filter(function (c) { return validIndexes(c.idea_indexes) && c.idea_indexes.length >= 2; });
  var duplicates = (parsed.duplicates || []).filter(function (d) { return validIndexes(d.idea_indexes) && d.idea_indexes.length >= 2; });

  return { clusters: clusters, duplicates: duplicates, note: parsed.note || '' };
}

module.exports = { classifyActivity, analyzeThoughts };
