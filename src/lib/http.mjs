import 'dotenv/config';
import { Agent, fetch as undiciFetch } from 'undici';
import { UA } from './constants.mjs';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Shared pool: keep-alive + many sockets to basketball-reference.com speeds up parallel scrapes. */
const poolConnections = Math.min(
  256,
  Math.max(32, parseInt(process.env.BR_CONNECTION_POOL || '128', 10))
);

const dispatcher = new Agent({
  keepAliveTimeout: 45_000,
  keepAliveMaxTimeout: 300_000,
  connections: poolConnections,
});

export function delayBetweenRequests() {
  const ms = Number(process.env.DELAY_MS) || 0;
  return delay(ms);
}

/** Use same pool for ingest POSTs (different host still benefits from a warm client). */
export async function pooledFetch(url, init = {}) {
  return undiciFetch(url, { ...init, dispatcher });
}

export async function fetchText(url, { retries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const ctrl = new AbortController();
      const ms = Number(process.env.FETCH_TIMEOUT_MS) || 45000;
      const t = setTimeout(() => ctrl.abort(), ms);
      try {
        const res = await undiciFetch(url, {
          dispatcher,
          signal: ctrl.signal,
          headers: {
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        if (res.status === 429 || res.status === 503) {
          lastErr = new Error(`HTTP ${res.status} for ${url} (attempt ${i + 1}/${retries + 1})`);
          await delay(4000 + 3000 * i);
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return await res.text();
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
