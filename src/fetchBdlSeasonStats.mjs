import { pooledFetch } from './lib/http.mjs';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function intEnv(name, min, max, fallback) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** NBA season year as Ball Dont Lie `season` (e.g. 2025 for 2025–26). */
export function inferBdlSeasonYear() {
  const fromEnv = process.env.BDL_STATS_SEASON;
  if (fromEnv != null && fromEnv !== '') {
    const n = parseInt(fromEnv, 10);
    if (Number.isFinite(n)) return n;
  }
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return m >= 10 ? y : y - 1;
}

/**
 * GET /v1/season_averages/general?season=&season_type=regular&type=base&player_ids[]=
 * @returns Map<playerId number, { season, stats, player }>
 */
export async function fetchGeneralBaseByPlayerIds(apiKey, baseRoot, season, playerIds, log) {
  const map = new Map();
  if (!playerIds.length) return map;

  const batchSize = intEnv('BDL_STATS_BATCH_SIZE', 1, 100, 25);
  const betweenMs = intEnv('BDL_STATS_REQUEST_DELAY_MS', 0, 120_000, 2100);
  const base = baseRoot.replace(/\/$/, '');

  for (let i = 0; i < playerIds.length; i += batchSize) {
    const batch = playerIds.slice(i, i + batchSize);
    const qs = new URLSearchParams();
    qs.set('season', String(season));
    qs.set('season_type', 'regular');
    qs.set('type', 'base');
    qs.set('per_page', '100');
    for (const id of batch) qs.append('player_ids[]', String(id));

    const url = `${base}/season_averages/general?${qs.toString()}`;
    let attempt = 0;
    let json;
    for (;;) {
      attempt++;
      const res = await pooledFetch(url, {
        headers: { Authorization: apiKey, Accept: 'application/json' },
      });
      const text = await res.text();
      if (res.status === 401) {
        log(
          `BallDontLie season_averages: HTTP 401 (tier may not include this endpoint). Continuing without stats for this batch.`
        );
        json = { data: [] };
        break;
      }
      if (res.status === 429 || res.status === 503) {
        const wait = Math.min(120_000, 5000 * attempt);
        log(`BallDontLie season_averages rate limit (${res.status}), waiting ${wait}ms…`);
        await delay(wait);
        continue;
      }
      if (!res.ok) {
        log(`BallDontLie season_averages HTTP ${res.status}: ${text.slice(0, 200)} — skipping batch.`);
        json = { data: [] };
        break;
      }
      try {
        json = JSON.parse(text);
      } catch (e) {
        log(`BallDontLie season_averages JSON error: ${e.message}`);
        json = { data: [] };
      }
      break;
    }

    const rows = Array.isArray(json.data) ? json.data : [];
    for (const row of rows) {
      const pid = row.player?.id ?? row.player_id;
      if (pid != null) map.set(Number(pid), row);
    }
    log(`BallDontLie season averages: +${rows.length} rows (map size ${map.size}, batch ${i / batchSize + 1})`);
    if (betweenMs > 0 && i + batchSize < playerIds.length) await delay(betweenMs);
  }

  return map;
}
