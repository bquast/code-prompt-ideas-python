// PyArena — app.js

// TODO: remove prompt title and #

let pyodide = null;
let currentPrompt = null;
let promptQueue = [];
let sessionVotes = { A: 0, B: 0, skip: 0 };
let codeA = '', codeB = '';
let modelA = '', modelB = '';   // actual model ids for current battle
let bothReady = false;
let allModels = [];             // fetched once from /api/config

const $ = id => document.getElementById(id);

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener('load', async () => {
  $('loading-msg').textContent = 'Loading Python runtime…';
  try {
    pyodide = await loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/'
    });
  } catch (e) {
    $('loading-msg').textContent = 'Failed to load Pyodide — try refreshing.';
    return;
  }

  // Fetch model list once
  try {
    const cfg = await fetchJSON('/api/config');
    allModels = cfg.models || [];
  } catch (_) {}

  promptQueue = shuffle([...window.PROMPTS]);
  $('loading-screen').style.display = 'none';
  $('arena').style.display = 'block';
  loadNextBattle();
});

// ── Battle lifecycle ──────────────────────────────────────────────────────────

async function loadNextBattle() {
  if (promptQueue.length === 0) {
    showSessionEnd();
    return;
  }

  currentPrompt = promptQueue.pop();
  codeA = '';
  codeB = '';
  bothReady = false;

  // Pick 2 random models from the pool, randomly assign left/right
  const pair = pickPair(allModels);
  modelA = pair[0];
  modelB = pair[1];

  // Reset UI — hide model names until after vote
  $('card-a').className = 'code-card';
  $('card-b').className = 'code-card';
  $('code-a').innerHTML = '<span class="placeholder">generating…</span>';
  $('code-b').innerHTML = '<span class="placeholder">generating…</span>';
  $('output-a').textContent = '';
  $('output-a').className = 'output-text';
  $('output-b').textContent = '';
  $('output-b').className = 'output-text';
  $('status-a').textContent = 'generating…';
  $('status-a').className = 'card-status';
  $('status-b').textContent = 'generating…';
  $('status-b').className = 'card-status';
  $('model-a-name').textContent = modelA;
  $('model-b-name').textContent = modelB;
  $('model-a-name').classList.add('hidden');
  $('model-b-name').classList.add('hidden');
  $('vote-a').disabled = true;
  $('vote-b').disabled = true;
  $('vote-skip').disabled = true;
  $('vote-area').style.display = 'grid';
  $('next-area').style.display = 'none';

  $('prompt-category').textContent = currentPrompt.category;
  $('prompt-num').textContent = `${window.PROMPTS.length - promptQueue.length} / ${window.PROMPTS.length}`;
  $('prompt-text').textContent = currentPrompt.text;

  Promise.all([
    generateAndRun('A', modelA),
    generateAndRun('B', modelB),
  ]);
}

async function generateAndRun(side, model) {
  const statusEl = $('status-' + side.toLowerCase());
  const codeEl   = $('code-'   + side.toLowerCase());
  const outputEl = $('output-' + side.toLowerCase());

  try {
    const res = await fetchJSON('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ model, prompt: currentPrompt.text, promptId: currentPrompt.id }),
    });

    const code = res.code || '';
    if (side === 'A') codeA = code; else codeB = code;

    codeEl.textContent = code;
    statusEl.textContent = 'running…';
    statusEl.className = 'card-status running';

    let stdout = '';
    pyodide.setStdout({ batched: s => { stdout += s + '\n'; } });
    pyodide.setStderr({ batched: () => {} });

    const STDIN_STUB = 'import sys, io\nsys.stdin = io.StringIO("")\n';
    try {
      await pyodide.runPythonAsync(STDIN_STUB + code);
      outputEl.textContent = stdout.trim() || '(no output)';
      outputEl.className = 'output-text';
      statusEl.textContent = 'done';
      statusEl.className = 'card-status done';
    } catch (pyErr) {
      const msg = (pyErr.message || String(pyErr)).split('\n').slice(-3).join('\n');
      outputEl.textContent = msg;
      outputEl.className = 'output-text err';
      statusEl.textContent = 'error';
      statusEl.className = 'card-status error';
    }

  } catch (fetchErr) {
    codeEl.textContent = '';
    outputEl.textContent = 'Could not reach model API: ' + fetchErr.message;
    outputEl.className = 'output-text err';
    statusEl.textContent = 'error';
    statusEl.className = 'card-status error';
  }

  checkBothReady();
}

function checkBothReady() {
  const aSettled = !['generating…', 'running…'].includes($('status-a').textContent);
  const bSettled = !['generating…', 'running…'].includes($('status-b').textContent);
  if (aSettled && bSettled && !bothReady) {
    bothReady = true;
    $('vote-a').disabled = false;
    $('vote-b').disabled = false;
    $('vote-skip').disabled = false;
  }
}

// ── Voting ────────────────────────────────────────────────────────────────────

window.vote = async function(choice) {
  $('vote-a').disabled = true;
  $('vote-b').disabled = true;
  $('vote-skip').disabled = true;

  if (choice === 'A') {
    $('card-a').className = 'code-card winner';
    $('card-b').className = 'code-card loser';
    sessionVotes.A++;
  } else if (choice === 'B') {
    $('card-b').className = 'code-card winner';
    $('card-a').className = 'code-card loser';
    sessionVotes.B++;
  } else {
    sessionVotes.skip++;
  }

  // Reveal model names after vote
  $('model-a-name').classList.remove('hidden');
  $('model-b-name').classList.remove('hidden');

  const winnerModel = choice === 'A' ? modelA : choice === 'B' ? modelB : 'skip';
  const tally = `${modelA} ${sessionVotes.A}  ·  ${modelB} ${sessionVotes.B}  ·  skipped ${sessionVotes.skip}`;
  $('vote-result').textContent = choice === 'skip' ? `skipped  ·  ${tally}` : `${winnerModel} won  ·  ${tally}`;
  $('vote-area').style.display = 'none';
  $('next-area').style.display = 'flex';

  // Post to D1
  try {
    const res = await fetchJSON('/api/vote', {
      method: 'POST',
      body: JSON.stringify({
        promptId: currentPrompt.id,
        promptText: currentPrompt.text,
        category: currentPrompt.category,
        winner: choice,
        modelA,
        modelB,
        codeA,
        codeB,
      }),
    });
    if (!res.stored) console.warn('[vote] D1 not stored:', res.error || 'check DB binding');
  } catch (e) { console.warn('[vote] failed:', e.message); }
};

window.nextBattle = loadNextBattle;

// ── Session end ───────────────────────────────────────────────────────────────

function showSessionEnd() {
  $('arena').innerHTML = `
    <div class="session-end">
      <h2>Session complete</h2>
      <p>${sessionVotes.A + sessionVotes.B} votes cast · ${sessionVotes.skip} skipped</p>
      <button class="next-btn" onclick="location.reload()">Play again</button>
    </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJSON(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Pick 2 distinct models at random, shuffle their left/right position
function pickPair(models) {
  if (!models || models.length < 2) return ['Model A', 'Model B'];
  const copy = shuffle([...models]);
  return [copy[0], copy[1]];
}
