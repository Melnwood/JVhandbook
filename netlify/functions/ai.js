// AI proxy for the JV Handbook System — drafting and translation via Claude.
//
// The Anthropic key NEVER reaches the browser. It lives in the ANTHROPIC_API_KEY
// environment variable on Netlify and is only used server-side here.
//
// Like the Airtable proxy, this is deliberately NOT a general passthrough. It
// permits exactly two tasks (draft, translate), builds the prompt itself, and
// caps input size — the browser cannot send arbitrary prompts to the model.

const MODEL = 'claude-opus-4-8';
const MAX_SOURCE = 20000; // characters of section text accepted per call

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

// Ask Claude and return the plain text of the reply.
const ask = async (system, user) => {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${JSON.stringify(data.error || data).slice(0, 300)}`);
  }
  if (data.stop_reason === 'refusal') {
    throw new Error('The model declined this request.');
  }
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return text;
};

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Use POST.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return json(500, { error: 'ANTHROPIC_API_KEY is not set on this deploy.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Bad JSON.' });
  }

  const task = body.task;
  const source = String(body.source || '');
  const country = String(body.country || '').slice(0, 60);
  const org = String(body.org || '').slice(0, 80);
  const language = String(body.language || '').slice(0, 40);
  const no = String(body.no || '').slice(0, 12);
  const title = String(body.title || '').slice(0, 120);
  const classification = String(body.classification || '').slice(0, 40);

  if (!source.trim()) return json(400, { error: 'No source text supplied.' });
  if (source.length > MAX_SOURCE) return json(400, { error: 'Section text is too long.' });

  try {
    let text;

    if (task === 'draft') {
      // Suggest local wording for a country, tailored from the JV master text.
      const system =
        'You help country teams of Josiah Venture (a Christian youth-ministry organization) adapt ' +
        'their staff handbook. You write in clear, professional English suitable for an HR handbook. ' +
        'You return ONLY the drafted section text — no preamble, no headings you were not given, no commentary.';
      const user =
        `Draft the local version of handbook section ${no} "${title}" for ${country}` +
        (org ? ` (national organization: ${org})` : '') + '.\n\n' +
        `This section's classification is "${classification}". ` +
        'Where the master text contains bracketed blanks like [LOCAL: …] or [NOT YET DRAFTED], ' +
        "replace them with plausible, country-appropriate wording that a local HR admin can review and refine. " +
        'Keep everything else faithful to the master text. Do not invent specific legal figures you cannot know — ' +
        'instead write a clearly-marked placeholder the country can fill in.\n\n' +
        `MASTER TEXT:\n${source}`;
      text = await ask(system, user);
    } else if (task === 'translate') {
      if (!language) return json(400, { error: 'No target language supplied.' });
      const system =
        `You are a professional translator. Translate the given staff-handbook section into ${language}. ` +
        'Preserve meaning, structure, line breaks, lists, and any bracketed placeholders exactly. ' +
        'Keep proper nouns and organization names (e.g. Josiah Venture, JV) as-is. ' +
        'Return ONLY the translation — no preamble, no notes, no back-translation.';
      const user = `Translate section ${no} "${title}" into ${language}:\n\n${source}`;
      text = await ask(system, user);
    } else {
      return json(400, { error: 'Unknown task. Use "draft" or "translate".' });
    }

    return json(200, { text });
  } catch (err) {
    return json(502, { error: String(err.message || err) });
  }
};
