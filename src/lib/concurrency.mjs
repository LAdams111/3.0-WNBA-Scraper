function intEnv(name, fallback) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Parallel Basketball Reference player page fetches (1–32). Raise for speed; lower if BR returns 429. */
export function playerConcurrency() {
  return Math.min(32, Math.max(1, intEnv('CONCURRENCY', 12)));
}
