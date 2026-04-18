function intEnv(name, fallback) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Parallel Basketball Reference player page fetches (1–48). Lower CONCURRENCY if BR returns 429. */
export function playerConcurrency() {
  return Math.min(48, Math.max(1, intEnv('CONCURRENCY', 24)));
}
