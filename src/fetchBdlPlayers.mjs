import { pooledFetch } from './lib/http.mjs';
import { fetchGeneralBaseByPlayerIds, inferBdlSeasonYear } from './fetchBdlSeasonStats.mjs';
import { toHoopCentralFromBdl } from './mapBdlToIngest.mjs';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function intEnv(name, min, max, fallback) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Paginated GET against Ball Dont Lie NBA API (cursor-based), then optional season averages.
 * @see https://docs.balldontlie.io/
 */
export async function fetchAllBdlPlayers(log = console.log) {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) {
    throw new Error('Set BALLDONTLIE_API_KEY (see .env.example).');
  }

  const base = (process.env.BALLDONTLIE_BASE_URL || 'https://api.balldontlie.io/v1').replace(/\/$/, '');
  const mode = (process.env.BDL_PLAYER_LIST || 'all').toLowerCase();
  const listPath = mode === 'active' ? '/players/active' : '/players';
  const perPage = intEnv('BDL_PER_PAGE', 1, 100, 100);
  const betweenMs = intEnv('BDL_REQUEST_DELAY_MS', 0, 120_000, 2100);
  const maxPages = intEnv('BDL_MAX_PAGES', 1, 50_000, 10_000);
  const fetchStats = process.env.BDL_FETCH_SEASON_STATS !== '0';

  const rows = [];
  let cursor;
  let pages = 0;

  for (;;) {
    if (pages++ > maxPages) {
      throw new Error(`BDL_MAX_PAGES (${maxPages}) exceeded — check pagination or raise limit.`);
    }

    const qs = new URLSearchParams();
    qs.set('per_page', String(perPage));
    if (cursor != null && cursor !== '') qs.set('cursor', String(cursor));

    const url = `${base}${listPath}?${qs}`;
    let attempt = 0;
    let json;
    for (;;) {
      attempt++;
      const res = await pooledFetch(url, {
        headers: {
          Authorization: apiKey,
          Accept: 'application/json',
        },
      });
      const text = await res.text();
      if (res.status === 429 || res.status === 503) {
        const wait = Math.min(120_000, 5000 * attempt);
        log(`BallDontLie rate limit (${res.status}), waiting ${wait}ms…`);
        await delay(wait);
        continue;
      }
      if (!res.ok) {
        throw new Error(`BallDontLie ${listPath} HTTP ${res.status}: ${text.slice(0, 500)}`);
      }
      try {
        json = JSON.parse(text);
      } catch (e) {
        throw new Error(`BallDontLie invalid JSON: ${e.message}`);
      }
      break;
    }

    const chunk = Array.isArray(json.data) ? json.data : [];
    rows.push(...chunk);
    log(`BallDontLie ${listPath}: +${chunk.length} (total ${rows.length})`);

    const next = json.meta?.next_cursor;
    if (next == null || next === '' || chunk.length === 0) break;
    cursor = next;
    if (betweenMs > 0) await delay(betweenMs);
  }

  let avgById = new Map();
  if (fetchStats && rows.length) {
    const season = inferBdlSeasonYear();
    log(`Fetching season ${season} general/base averages for ${rows.length} players…`);
    const ids = rows.map((r) => r.id).filter((id) => id != null);
    avgById = await fetchGeneralBaseByPlayerIds(apiKey, base, season, ids, log);
  }

  return rows.map((p) => toHoopCentralFromBdl(p, avgById.get(Number(p.id)) || null));
}
