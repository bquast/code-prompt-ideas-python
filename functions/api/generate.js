// /functions/api/generate.js
// Calls model A or B based on `side` param.
// Returns { code: string } — clean Python only, no markdown fences.
//
// Environment variables (set in CF Pages dashboard):
//   model_A_name, model_A_url, model_A_api_key
//   model_B_name, model_B_url, model_B_api_key
//
// model_A_name is both the model identifier sent to the API and the label shown in the UI.
// Example values for OpenAI + Grok:
//   model_A_name = gpt-4o-mini
//   model_A_url  = https://api.openai.com/v1/chat/completions
//   model_B_name = grok-3-mini
//   model_B_url  = https://api.x.ai/v1/chat/completions

const SYSTEM_PROMPT = `You are a Python code generator.
The user gives you a task. You reply with ONLY a short, self-contained Python script that:
- Uses only the standard library (no pip installs)
- Prints its output to stdout
- Is at most 25 lines
- Has no markdown, no code fences, no explanation — just raw Python code
- Never uses input() — hardcode any example data directly in the script
Do not include \`\`\`python or \`\`\` delimiters. Output only the Python source.`;

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { side, model: modelFromBody, prompt } = body;
  if (!prompt) {
    return Response.json({ error: 'Missing prompt' }, { status: 400 });
  }

  // model can be passed directly, or derived from side + env vars (backwards compat)
  let model = modelFromBody;
  let url, apiKey;

  if (model) {
    // New path: model name passed directly, look up matching env vars
    const prefix = findPrefix(env, model);
    if (!prefix) {
      return Response.json({ error: `No config found for model: ${model}` }, { status: 503 });
    }
    url    = env[`${prefix}_url`];
    apiKey = env[`${prefix}_api_key`];
  } else {
    // Legacy path: side-based lookup
    const prefix = side === 'A' ? 'model_A' : 'model_B';
    url    = env[`${prefix}_url`];
    apiKey = env[`${prefix}_api_key`];
    model  = env[`${prefix}_name`];
  }

  console.log(`[generate] model=${model} url=${url} hasKey=${!!apiKey}`);

  if (!url || !apiKey || !model) {
    console.log(`[generate] missing config: url=${!!url} apiKey=${!!apiKey} model=${!!model}`);
    return Response.json({ error: `Model not fully configured` }, { status: 503 });
  }

  try {
    const code = await callModel(url, apiKey, model, prompt);
    return Response.json({ code: stripFences(code) });
  } catch (e) {
    console.log(`[generate] callModel error: ${e.message}`);
    return Response.json({ error: e.message }, { status: 502 });
  }
}

// ── Model caller — OpenAI-compatible ─────────────────────────────────────────
// Works with OpenAI, xAI/Grok, Together, Groq, Mistral, local llama.cpp, etc.

async function callModel(url, apiKey, model, userPrompt) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userPrompt },
      ],
      max_tokens: 512,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Model API error ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = await res.json();

  const choice = data?.choices?.[0];
  if (choice) {
    return choice.message?.content || '';
  }

  throw new Error('Unrecognised response shape from model API');
}

// ── Find env prefix matching a model name ─────────────────────────────────────

function findPrefix(env, modelName) {
  for (const prefix of ['model_A', 'model_B', 'model_C', 'model_D']) {
    if (env[`${prefix}_name`] === modelName) return prefix;
  }
  return null;
}

function stripFences(code) {
  return code
    .replace(/^```[a-z]*\n?/m, '')
    .replace(/```\s*$/m, '')
    .trim();
}
