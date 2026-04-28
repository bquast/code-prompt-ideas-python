Live: <https://code-prompt-ideas-python.pages.dev/>

# PyArena

Head-to-head Python code battles. Two models get the same prompt, generate Python, it runs in-browser via Pyodide, user votes.

## File structure

```
index.html
style.css
app.js
prompts.js
functions/
  api/
    config.js     → GET  /api/config   — returns model display names
    generate.js   → POST /api/generate — calls model, returns Python code
    vote.js       → POST /api/vote     — stores result in D1
```

## Cloudflare Pages setup

### 1. Deploy
Connect repo to Cloudflare Pages. No build step — deploy root as-is.

### 2. Environment variables
Set in **Pages → Settings → Environment variables**:

| Variable         | Example value                                          |
|------------------|--------------------------------------------------------|
| `model_A_name`   | `gpt-4o-mini`                                          |
| `model_A_url`    | `https://api.openai.com/v1/chat/completions`           |
| `model_A_api_key`| `sk-...`                                               |
| `model_B_name`   | `grok-3-mini`                                          |
| `model_B_url`    | `https://api.x.ai/v1/chat/completions`                 |
| `model_B_api_key`| `xai-...`                                              |

`model_A_name` / `model_B_name` are used as both the model identifier in API requests and the label shown in the UI. Both endpoints must be OpenAI-compatible (`/chat/completions` shape). xAI's Grok API is compatible out of the box.

### 3. D1 database (for vote storage)

Create database:
```sh
wrangler d1 create pyarena-db
```

Create table:
```sh
wrangler d1 execute pyarena-db --command "
CREATE TABLE IF NOT EXISTS votes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT    NOT NULL DEFAULT (datetime('now')),
  prompt_id TEXT    NOT NULL,
  prompt    TEXT    NOT NULL,
  category  TEXT    NOT NULL,
  winner    TEXT    NOT NULL,
  code_a    TEXT,
  code_b    TEXT
);"
```

Bind in **Pages → Settings → Functions → D1 database bindings**:
- Binding name: `DB`
- Database: `pyarena-db`

### 4. Query your dataset

```sh
wrangler d1 execute pyarena-db --command "
SELECT prompt_id, prompt, category,
       SUM(winner='A') as votes_a,
       SUM(winner='B') as votes_b,
       SUM(winner='skip') as skips,
       COUNT(*) as total
FROM votes
GROUP BY prompt_id
ORDER BY total DESC;"
```

Export as CSV:
```sh
wrangler d1 execute pyarena-db --command "SELECT * FROM votes;" --json > votes.json
```

## Adding prompts

Edit `prompts.js`. Each entry:
```js
{ id: 'p21', category: 'your-category', text: 'Your prompt here' }
```

Keep IDs unique — they are the join key in the votes table.
```
