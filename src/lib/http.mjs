import 'dotenv/config';
import { Agent, fetch as undiciFetch } from 'undici';
import { UA } from './constants.mjs';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function intEnv(name, min, max, fallback) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Shared pool: keep-alive to basketball-reference.com. */
const poolConnections = intEnv('BR_CONNECTION_POOL', 8, 128, 40);

const dispatcher = new Agent({
  keepAliveTimeout: 45_000,
  keepAliveMaxTimeout: 300_000,
  connections: poolConnections,
});

export function delayBetweenRequests() {
  const ms = Number(process.env.DELAY_MS) || 0;
  return delay(ms);
}

export async function pooledFetch(url, init = {}) {
  return undiciFetch(url, { ...init, dispatcher });
}

function isBasketballReference(url) {
  return typeof url === 'string' && url.includes('basketball-reference.com');
}

/** Fixed gap when BR_ADAPTIVE=0. */
const brGapFixedMs = intEnv('BR_MIN_INTERVAL_MS', 200, 15_000, 750);

const brAdaptive = process.env.BR_ADAPTIVE !== '0';
const gapFloor = intEnv('BR_GAP_FLOOR_MS', 120, 5000, 260);
const gapCeiling = intEnv('BR_GAP_CEILING_MS', gapFloor, 30_000, 2200);
const gapInitial = intEnv('BR_MIN_INTERVAL_MS', gapFloor, gapCeiling, 520);
const shrinkEveryOk = intEnv('BR_ADAPTIVE_OK_STREAK', 1, 80, 10);
const shrinkMs = intEnv('BR_ADAPTIVE_SHRINK_MS', 5, 250, 40);
const widen429Factor = intEnv('BR_ADAPTIVE_429_MULT', 110, 250, 135) / 100;

let adaptiveGapMs = gapInitial;
let okStreakForShrink = 0;

let brGate = Promise.resolve();
let brNextSlot = 0;
let brCooldownUntil = 0;
let br429Streak = 0;

function currentBrGapMs() {
  if (!brAdaptive) return brGapFixedMs;
  return Math.min(gapCeiling, Math.max(gapFloor, adaptiveGapMs));
}

function retryAfterMs(res) {
  const h = res.headers?.get?.('retry-after');
  if (!h) return null;
  const t = h.trim();
  const secs = parseInt(t, 10);
  if (Number.isFinite(secs) && String(secs) === t) return secs * 1000;
  const when = Date.parse(t);
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return null;
}

function noteBr429(res) {
  const fromHeader = retryAfterMs(res);
  const exp = Math.min(120_000, 10_000 * 2 ** Math.min(br429Streak, 5));
  const base = fromHeader ?? exp;
  br429Streak = Math.min(br429Streak + 1, 8);
  const until = Date.now() + base + Math.random() * 1500;
  brCooldownUntil = Math.max(brCooldownUntil, until);
  brNextSlot = Math.max(brNextSlot, brCooldownUntil);

  if (brAdaptive) {
    okStreakForShrink = 0;
    const next = Math.ceil(currentBrGapMs() * widen429Factor + 60);
    adaptiveGapMs = Math.min(gapCeiling, Math.max(gapFloor, next));
    brNextSlot = Math.max(brNextSlot, Date.now() + Math.min(2000, adaptiveGapMs));
  }
}

function noteBrOk() {
  br429Streak = Math.max(0, br429Streak - 1);
  if (!brAdaptive) return;
  okStreakForShrink++;
  if (okStreakForShrink >= shrinkEveryOk) {
    okStreakForShrink = 0;
    adaptiveGapMs = Math.max(gapFloor, adaptiveGapMs - shrinkMs);
  }
}

/**
 * Serialize slot reservation so concurrent workers cannot burst past BR rate limits.
 * Gap is adaptive (when enabled): tightens after OK streaks, widens on 429.
 */
async function awaitBrSpacing() {
  const prev = brGate;
  let release;
  brGate = new Promise((r) => {
    release = r;
  });
  await prev;
  try {
    for (;;) {
      const now = Date.now();
      if (now >= brCooldownUntil) break;
      await delay(Math.min(500, Math.max(50, brCooldownUntil - now)));
    }
    const now = Date.now();
    const startAt = Math.max(now, brNextSlot);
    const gap = currentBrGapMs();
    brNextSlot = startAt + gap;
    const wait = startAt - now;
    if (wait > 0) await delay(wait);
  } finally {
    release();
  }
}

const brFetchHeaders = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

export async function fetchText(url, { retries = 5 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    if (isBasketballReference(url)) {
      await awaitBrSpacing();
    }
    try {
      const ctrl = new AbortController();
      const ms = Number(process.env.FETCH_TIMEOUT_MS) || 45000;
      const t = setTimeout(() => ctrl.abort(), ms);
      try {
        const res = await undiciFetch(url, {
          dispatcher,
          signal: ctrl.signal,
          headers: brFetchHeaders,
        });
        if (res.status === 429 || res.status === 503 || res.status === 502) {
          if (isBasketballReference(url)) noteBr429(res);
          lastErr = new Error(`HTTP ${res.status} for ${url} (attempt ${i + 1}/${retries + 1})`);
          const backoff = 2000 + 2500 * i + (isBasketballReference(url) ? 3000 : 0);
          await delay(backoff);
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const text = await res.text();
        if (isBasketballReference(url)) noteBrOk();
        return text;
      } finally {
        clearTimeout(t);
      }
    } catch (e) {
      lastErr = e;
      await delay(800 + 800 * i);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(lastErr ? String(lastErr) : `Request failed after retries: ${url}`);
}
