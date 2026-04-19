/** Ball Dont Lie auth: first non-empty wins (Railway typos / legacy names). */
export function getBdlApiKey() {
  const candidates = [
    process.env.BALLDONTLIE_API_KEY,
    process.env.BDL_API_KEY,
    process.env.BALL_DONT_LIE_API_KEY,
  ];
  for (const c of candidates) {
    const t = typeof c === 'string' ? c.trim() : '';
    if (t) return t;
  }
  return '';
}

export function missingBdlApiKeyMessage() {
  return `Ball Dont Lie API key is not set.

Railway: open this service → Variables → add ONE of:
  BALLDONTLIE_API_KEY   (recommended name)
  BDL_API_KEY           (short alias)
  BALL_DONT_LIE_API_KEY (spelled-out alias)

Use the key from https://app.balldontlie.io (Dashboard → API).
Note: INGEST_API_KEY is only for your Hoop Central backend, not Ball Dont Lie.

Local: copy .env.example to .env and set BALLDONTLIE_API_KEY=...`;
}
