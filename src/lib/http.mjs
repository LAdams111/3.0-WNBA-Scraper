import 'dotenv/config';
import { UA } from './constants.mjs';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export function delayBetweenRequests() {
  const ms = Number(process.env.DELAY_MS) || 250;
  return delay(ms);
}

export async function fetchText(url, { retries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const ctrl = new AbortController();
      const ms = Number(process.env.FETCH_TIMEOUT_MS) || 60000;
      const t = setTimeout(() => ctrl.abort(), ms);
      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: {
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        if (res.status === 429 || res.status === 503) {
          lastErr = new Error(`HTTP ${res.status} for ${url} (attempt ${i + 1}/${retries + 1})`);
          await delay(6000 + 4000 * i);
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return await res.text();
      } finally {
        clearTimeout(t);
      }
    } catch (e) {
      lastErr = e;
      await delay(1500 + 1500 * i);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(lastErr ? String(lastErr) : `Request failed after retries: ${url}`);
}
