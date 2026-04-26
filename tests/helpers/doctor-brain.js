/**
 * Doctor Brain — uses Claude API to make clinical decisions during E2E tests.
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 * Uses fetch directly to avoid CJS/ESM module conflicts with the SDK.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001'; // fast + cheap for test decisions

async function callClaude(messages, maxTokens = 512) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is required');

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Claude API error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  return data.content[0].text.trim();
}

function parseJSON(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Generate a realistic clinical note for a given scenario.
 */
export async function generateClinicalNote(scenario) {
  return callClaude([{
    role: 'user',
    content: `You are a junior doctor writing a clinical note. Write a realistic but deliberately INCOMPLETE clinical note for this scenario:

${scenario}

Requirements:
- Write 4-8 lines of clinical note text
- Include some relevant clinical details but deliberately OMIT a few important items (e.g. allergies, observations, drug doses, examination findings)
- Use realistic medical abbreviations and terminology
- Do NOT use any HTML tags — plain text only
- Do NOT include any meta-commentary or explanation — just the note itself`
  }], 1024);
}

/**
 * Decide whether to accept or skip a completeness suggestion.
 * Returns { action: 'accept'|'skip', value?: string, reason: string }
 */
export async function decideCompleteness(suggestionText, noteContext, inputType) {
  const text = await callClaude([{
    role: 'user',
    content: `You are a junior doctor reviewing your clinical note. The system suggests you've missed something:

SUGGESTION: ${suggestionText}
INPUT TYPE: ${inputType || 'free-text'}
YOUR CURRENT NOTE: ${noteContext}

Decide: should you ACCEPT this suggestion (add the information) or SKIP it (not relevant)?

If accepting and the input type is free-text, provide a realistic clinical value.
If accepting and the input type is a dropdown/select, pick the most likely option.

Respond in JSON only:
{"action": "accept" or "skip", "value": "the value to enter if accepting", "reason": "one sentence why"}`
  }]);

  return parseJSON(text) || { action: 'skip', reason: 'Could not parse response' };
}

/**
 * Decide which guideline scope to select.
 * Returns 'national' | 'local' | 'both'
 */
export async function decideScope(noteContext) {
  const answer = await callClaude([{
    role: 'user',
    content: `You are a doctor. Given this clinical note, should guidelines be checked against national guidelines, local trust guidelines, or both?

NOTE: ${noteContext}

Respond with a single word: "national", "local", or "both".`
  }], 128);

  if (answer.toLowerCase().includes('local')) return 'local';
  if (answer.toLowerCase().includes('both')) return 'both';
  return 'national';
}

/**
 * Decide whether to accept or skip a guideline suggestion.
 * Returns { action: 'accept'|'skip', reason: string }
 */
export async function decideGuideline(suggestionText, guidelineName, noteContext) {
  const text = await callClaude([{
    role: 'user',
    content: `You are a junior doctor. The system analysed your note against "${guidelineName}" and suggests:

SUGGESTION: ${suggestionText}
YOUR NOTE: ${noteContext}

Is this suggestion clinically relevant and worth adding to the note? Respond in JSON only:
{"action": "accept" or "skip", "reason": "one sentence why"}`
  }]);

  return parseJSON(text) || { action: 'accept', reason: 'Default accept' };
}

/**
 * Evaluate the final note quality.
 * Returns { score: 1-10, assessment: string, issues: string[] }
 */
export async function evaluateFinalNote(originalNote, finalNote, scenario) {
  const text = await callClaude([{
    role: 'user',
    content: `You are a senior doctor reviewing a junior's clinical note after they used an AI assistant.

SCENARIO: ${scenario}
ORIGINAL NOTE: ${originalNote}
FINAL NOTE (after AI suggestions): ${finalNote}

Rate the final note 1-10 and assess:
- Is it more complete than the original?
- Are the additions clinically sensible?
- Any concerns?

Respond in JSON:
{"score": N, "assessment": "summary", "issues": ["issue1", "issue2"]}`
  }]);

  return parseJSON(text) || { score: 5, assessment: 'Could not parse', issues: [] };
}
