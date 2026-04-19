import { getBrLaneCount } from './http.mjs';

function intEnv(name, min, max, fallback) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Parallel BR page workers (1–48).
 * Default ≈ 4 × number of egress lanes (direct + each HTTP proxy in BR_PROXY_URLS), capped at 48.
 */
export function playerConcurrency() {
  const lanes = Math.max(1, getBrLaneCount());
  const mult = intEnv('CONCURRENCY_PER_PROXY', 1, 12, 4);
  const suggest = Math.min(48, Math.max(2, lanes * mult));
  const fromEnv = process.env.CONCURRENCY;
  if (fromEnv != null && fromEnv !== '') {
    const n = parseInt(fromEnv, 10);
    if (Number.isFinite(n) && n > 0) return Math.min(48, Math.max(1, n));
  }
  return suggest;
}
