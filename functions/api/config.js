// /functions/api/config.js
// Returns model identifiers for the UI.
// model_A_name / model_B_name serve as both the API model param and the display label.

export async function onRequestGet({ env }) {
  return Response.json({
    modelAName: env.model_A_name || 'Model A',
    modelBName: env.model_B_name || 'Model B',
  });
}
