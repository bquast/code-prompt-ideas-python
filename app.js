// PyArena — app.js
// Fetches Python code from two models via /api/generate,
// runs both in Pyodide, lets user vote, posts result to /api/vote.

let pyodide = null;
let currentPrompt = null;
let promptQueue = [];
let sessionVotes = { A: 0, B: 0, skip: 0 };
let codeA = '', codeB = '';
let bothReady = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────

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

  // Reset UI
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
  $('vote-a').disabled = true;
  $('vote-b').disabled = true;
  $('vote-skip').disabled = true;
  $('vote-area').style.display = 'grid';
  $('next-area').style.display = 'none';

  $('prompt-category').textContent = currentPrompt.category;
  $('prompt-num').textContent = `${window.PROMPTS.length - promptQueue.length} / ${window.PROMPTS.length}`;
  $('prompt-text').textContent = currentPrompt.text;

  // Fetch model names from config endpoint
  try {
    const cfg = await fetchJSON('/api/config');
    $('model-a-name').textContent = cfg.modelAName || 'Model A';
    $('model-b-name').textContent = cfg.modelBName || 'Model B';
  } catch (_) {
    $('model-a-name').textContent = 'Model A';
    $('model-b-name').textContent = 'Model B';
  }

  // Fire both requests in parallel
  Promise.all([
    generateAndRun('A'),
    generateAndRun('B'),
  ]);
}

async function generateAndRun(side) {
  const statusEl = $(('status-' + side).toLowerCase());
  const codeEl = $(('code-' + side).toLowerCase());
  const outputEl = $(('output-' + side).toLowerCase());

  try {
    // 1. Generate code from model
    const res = await fetchJSON('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ side, prompt: currentPrompt.text, promptId: currentPrompt.id }),
    });

    const code = res.code || '';
    if (side === 'A') codeA = code; else codeB = code;

    codeEl.textContent = code;
    statusEl.textContent = 'running…';
    statusEl.className = 'card-status running';

    // 2. Run in Pyodide
    let stdout = '';
    let stderr = '';
    pyodide.setStdout({ batched: s => { stdout += s + '\n'; } });
    pyodide.setStderr({ batched: s => { stderr += s + '\n'; } });

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

  // Enable voting once both sides are done
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

  // Reveal model names now that vote is cast
  $('model-a-name').classList.remove('hidden');
  $('model-b-name').classList.remove('hidden');
  $('model-a-label') && ($('model-a-label').style.display = 'none');
  $('model-b-label') && ($('model-b-label').style.display = 'none');

  const tally = `A ${sessionVotes.A}  ·  B ${sessionVotes.B}  ·  skipped ${sessionVotes.skip}`;
  $('vote-result').textContent = choice === 'skip' ? `skipped  ·  ${tally}` : `voted ${choice}  ·  ${tally}`;
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
        codeA,
        codeB,
      }),
    });
    if (!res.stored) console.warn('[vote] D1 not stored — check DB binding in Pages dashboard');
  } catch (e) { console.warn('[vote] failed:', e.message); }
};

window.nextBattle = loadNextBattle;

// ── Session end ───────────────────────────────────────────────────────────────

function showSessionEnd() {
  $('arena').innerHTML = `
    <div class="session-end">
      <h2>session complete</h2>
      <p>A won ${sessionVotes.A} &nbsp;·&nbsp; B won ${sessionVotes.B} &nbsp;·&nbsp; ${sessionVotes.skip} skipped</p>
      <button class="next-btn" onclick="location.reload()">play again</button>
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
