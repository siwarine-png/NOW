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

module.exports = { classifyActivity };
