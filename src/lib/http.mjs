import 'dotenv/config';
import { UA } from './constants.mjs';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export function delayBetweenRequests() {
  const ms = Number(process.env.DELAY_MS) || 3500;
  return delay(ms);
}

export async function fetchText(url, { retries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (res.status === 429 || res.status === 503) {
        await delay(6000 + 4000 * i);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await delay(1500 + 1500 * i);
    }
  }
  throw lastErr;
}
