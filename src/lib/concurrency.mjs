function intEnv(name, fallback) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Parallel player page fetches (stay polite: keep default modest). */
export function playerConcurrency() {
  return Math.min(12, Math.max(1, intEnv('CONCURRENCY', 4)));
}

/** Parallel letter-directory fetches during discovery. */
export function discoverConcurrency() {
  return Math.min(13, Math.max(1, intEnv('DISCOVER_CONCURRENCY', 8)));
}
