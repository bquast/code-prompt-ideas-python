// /functions/api/vote.js
// Stores a vote in Cloudflare D1.
//
// D1 binding name: DB  (set in CF Pages dashboard → Functions → D1 bindings)
// Run once to create the table:
//   wrangler d1 execute pyarena-db --command "
//     CREATE TABLE IF NOT EXISTS votes (
//       id        INTEGER PRIMARY KEY AUTOINCREMENT,
//       ts        TEXT    NOT NULL DEFAULT (datetime('now')),
//       prompt_id TEXT    NOT NULL,
//       prompt    TEXT    NOT NULL,
//       category  TEXT    NOT NULL,
//       winner    TEXT    NOT NULL,  -- 'A' | 'B' | 'skip'
//       code_a    TEXT,
//       code_b    TEXT
//     );"

export async function onRequestPost({ request, env }) {
  if (!env.DB) {
    console.warn('[vote] DB binding not found — set D1 binding named DB in Pages dashboard');
    return Response.json({ ok: true, stored: false });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { promptId, promptText, category, winner, codeA, codeB } = body;

  if (!promptId || !winner) {
    return Response.json({ error: 'Missing fields' }, { status: 400 });
  }

  try {
    await env.DB.prepare(
      `INSERT INTO votes (prompt_id, prompt, category, winner, code_a, code_b)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      promptId,
      promptText || '',
      category   || '',
      winner,
      codeA      || '',
      codeB      || ''
    ).run();

    return Response.json({ ok: true, stored: true });
  } catch (e) {
    // Log but don't surface DB errors to client
    console.error('D1 insert failed:', e.message);
    return Response.json({ ok: true, stored: false });
  }
}
