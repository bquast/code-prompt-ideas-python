// /functions/api/config.js
// Returns all configured model names as an array.
// Supports model_A through model_D — add more prefixes as needed.

export async function onRequestGet({ env }) {
  const prefixes = ['model_A', 'model_B', 'model_C', 'model_D'];
  const models = prefixes
    .map(p => env[`${p}_name`])
    .filter(Boolean);

  return Response.json({ models });
}
