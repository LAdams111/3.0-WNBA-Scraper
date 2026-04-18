function intEnv(name, fallback) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Parallel BR fetches (1–16). Default 4 with adaptive spacing in http.mjs. */
export function playerConcurrency() {
  return Math.min(16, Math.max(1, intEnv('CONCURRENCY', 4)));
}
