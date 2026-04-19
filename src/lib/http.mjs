import 'dotenv/config';
import { Agent, fetch as undiciFetch, ProxyAgent } from 'undici';
import { UA } from './constants.mjs';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function intEnv(name, min, max, fallback) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const poolConnections = intEnv('BR_CONNECTION_POOL', 8, 128, 40);

/** Used for ingest and any non-BR fetch (never routed through BR proxies). */
const directAgent = new Agent({
  keepAliveTimeout: 45_000,
  keepAliveMaxTimeout: 300_000,
  connections: poolConnections,
});

export function delayBetweenRequests() {
  const ms = Number(process.env.DELAY_MS) || 0;
  return delay(ms);
}

export async function pooledFetch(url, init = {}) {
  return undiciFetch(url, { ...init, dispatcher: init.dispatcher ?? directAgent });
}

function isBasketballReference(url) {
  return typeof url === 'string' && url.includes('basketball-reference.com');
}

function parseBrProxyUrls() {
  const parts = [process.env.BR_PROXY_URLS, process.env.BR_PROXY_URL]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

const proxyUriList = parseBrProxyUrls();
const includeDirectLane = process.env.BR_INCLUDE_DIRECT_LANE === '1';

/** @type {{ label: string, dispatcher: import('undici').Dispatcher }[]} */
const brDispatchers = [];

if (proxyUriList.length === 0) {
  brDispatchers.push({ label: 'direct', dispatcher: directAgent });
} else {
  if (includeDirectLane) {
    brDispatchers.push({ label: 'direct', dispatcher: directAgent });
  }
  for (const uri of proxyUriList) {
    if (/^socks\d*:/i.test(uri)) {
      console.error(`SOCKS proxies are not supported (use HTTP or HTTPS proxy): ${uri}`);
      process.exit(1);
    }
    try {
      new URL(uri);
    } catch (e) {
      console.error(`Invalid BR proxy URL (check BR_PROXY_URLS): ${uri}`);
      console.error(e?.message || e);
      process.exit(1);
    }
    try {
      brDispatchers.push({ label: 'proxy', dispatcher: new ProxyAgent(uri) });
    } catch (e) {
      console.error(`Could not create proxy client for: ${uri}`);
      console.error(e?.message || e);
      process.exit(1);
    }
  }
}

let pickSeq = 0;

/** How many independent BR egress lanes (direct and/or each proxy). */
export function getBrLaneCount() {
  return brDispatchers.length;
}

function pickBrLaneIndex() {
  return pickSeq++ % brDispatchers.length;
}

/** Fixed gap when BR_ADAPTIVE=0. */
const brGapFixedMs = intEnv('BR_MIN_INTERVAL_MS', 150, 15_000, 520);

const brAdaptive = process.env.BR_ADAPTIVE !== '0';
const gapFloor = intEnv('BR_GAP_FLOOR_MS', 100, 5000, 200);
const gapCeiling = intEnv('BR_GAP_CEILING_MS', gapFloor, 30_000, 1800);
const gapInitial = intEnv('BR_MIN_INTERVAL_MS', gapFloor, gapCeiling, 380);
const shrinkEveryOk = intEnv('BR_ADAPTIVE_OK_STREAK', 1, 80, 6);
const shrinkMs = intEnv('BR_ADAPTIVE_SHRINK_MS', 5, 300, 55);
const widen429Factor = intEnv('BR_ADAPTIVE_429_MULT', 110, 250, 128) / 100;

const laneCooldownCap = intEnv('BR_LANE_COOLDOWN_CAP_MS', 5000, 120_000, 40_000);
const laneCooldownBase = intEnv('BR_LANE_COOLDOWN_BASE_MS', 800, 15_000, 2800);

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

function createBrLane() {
  let brGate = Promise.resolve();
  let brNextSlot = 0;
  let brCooldownUntil = 0;
  let br429Streak = 0;
  let adaptiveGapMs = gapInitial;
  let okStreakForShrink = 0;

  function currentBrGapMs() {
    if (!brAdaptive) return brGapFixedMs;
    return Math.min(gapCeiling, Math.max(gapFloor, adaptiveGapMs));
  }

  function noteBr429(res) {
    const fromHeader = retryAfterMs(res);
    const exp = Math.min(
      laneCooldownCap,
      laneCooldownBase * 2 ** Math.min(br429Streak, 6)
    );
    const base = fromHeader ?? exp;
    br429Streak = Math.min(br429Streak + 1, 8);
    const until = Date.now() + base + Math.random() * 700;
    brCooldownUntil = Math.max(brCooldownUntil, until);
    brNextSlot = Math.max(brNextSlot, brCooldownUntil);

    if (brAdaptive) {
      okStreakForShrink = 0;
      const next = Math.ceil(currentBrGapMs() * widen429Factor + 60);
      adaptiveGapMs = Math.min(gapCeiling, Math.max(gapFloor, next));
      brNextSlot = Math.max(brNextSlot, Date.now() + Math.min(900, adaptiveGapMs));
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

  async function awaitSpacing() {
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

  return { awaitSpacing, noteBr429, noteBrOk };
}

const brLanes = brDispatchers.map(() => createBrLane());

const brFetchHeaders = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

const br429FetchBackoffBase = intEnv('BR_FETCH_429_BACKOFF_BASE_MS', 0, 8000, 450);
const br429FetchBackoffStep = intEnv('BR_FETCH_429_BACKOFF_STEP_MS', 0, 6000, 600);

export async function fetchText(url, { retries = 4 } = {}) {
  const isBr = isBasketballReference(url);
  const laneIdx = isBr ? pickBrLaneIndex() : 0;
  const lane = isBr ? brLanes[laneIdx] : null;
  const dispatcher = isBr ? brDispatchers[laneIdx].dispatcher : directAgent;

  let lastErr;
  for (let i = 0; i <= retries; i++) {
    if (lane) {
      await lane.awaitSpacing();
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
          if (lane) lane.noteBr429(res);
          lastErr = new Error(`HTTP ${res.status} for ${url} (attempt ${i + 1}/${retries + 1})`);
          const backoff = isBr
            ? br429FetchBackoffBase + br429FetchBackoffStep * i
            : 1200 + 1400 * i;
          await delay(backoff);
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const text = await res.text();
        if (lane) lane.noteBrOk();
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
