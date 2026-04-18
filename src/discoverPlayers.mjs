import { load } from 'cheerio';
import { BBR_BASE, WNBA_PLAYERS_INDEX } from './lib/constants.mjs';
import { fetchText, delayBetweenRequests } from './lib/http.mjs';

const PLAYER_PATH = /^\/wnba\/players\/[a-z]\/([a-z0-9]+)\.html$/;

function extractIds(html) {
  const $ = load(html);
  const ids = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(PLAYER_PATH);
    if (m) ids.add(m[1]);
  });
  return ids;
}

export async function discoverAllPlayerIds(log = console.log) {
  const ids = new Set();
  log('Fetching WNBA player directory…');
  const indexHtml = await fetchText(WNBA_PLAYERS_INDEX);
  for (const id of extractIds(indexHtml)) ids.add(id);

  if (process.env.FAST_DISCOVER === '1') {
    log(`FAST_DISCOVER=1: skipping a–z letter pages (${ids.size} ids from main index).`);
    return [...ids].sort();
  }

  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const letterUrls = [...letters].map((l) => `${BBR_BASE}/wnba/players/${l}/`);
  log(`Fetching ${letters.length} letter index pages sequentially (avoids BR 429 bursts)…`);
  const sizeBefore = ids.size;
  for (let j = 0; j < letterUrls.length; j++) {
    const letter = letters[j];
    try {
      const html = await fetchText(letterUrls[j]);
      for (const id of extractIds(html)) ids.add(id);
    } catch (e) {
      log(`  Letter ${letter}: skip (${e?.message || e})`);
    }
  }
  log(`  Letters a–z: +${ids.size - sizeBefore} new (total ${ids.size})`);
  await delayBetweenRequests();

  return [...ids].sort();
}

export function playerUrlForId(playerId) {
  const letter = playerId.charAt(0);
  return `${BBR_BASE}/wnba/players/${letter}/${playerId}.html`;
}
