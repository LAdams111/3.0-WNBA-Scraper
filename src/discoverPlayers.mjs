import { load } from 'cheerio';
import { BBR_BASE, WNBA_PLAYERS_INDEX } from './lib/constants.mjs';
import { discoverConcurrency } from './lib/concurrency.mjs';
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
  await delayBetweenRequests();
  for (const id of extractIds(indexHtml)) ids.add(id);

  if (process.env.FAST_DISCOVER === '1') {
    log(`FAST_DISCOVER=1: skipping a–z letter pages (${ids.size} ids from main index).`);
    return [...ids].sort();
  }

  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const disc = discoverConcurrency();
  log(`Fetching ${letters.length} letter index pages (${disc} at a time)…`);
  const letterUrls = [...letters].map((l) => `${BBR_BASE}/wnba/players/${l}/`);
  for (let i = 0; i < letterUrls.length; i += disc) {
    const chunk = letterUrls.slice(i, i + disc);
    const chunkLetters = [...letters].slice(i, i + disc);
    const settled = await Promise.allSettled(chunk.map((url) => fetchText(url)));
    const sizeBefore = ids.size;
    settled.forEach((out, j) => {
      const letter = chunkLetters[j];
      if (out.status === 'rejected') {
        log(`  Letter ${letter}: skip (${out.reason?.message || out.reason})`);
        return;
      }
      for (const id of extractIds(out.value)) ids.add(id);
    });
    const addedChunk = ids.size - sizeBefore;
    log(`  Letters ${chunkLetters[0]}–${chunkLetters[chunkLetters.length - 1]}: +${addedChunk} new (total ${ids.size})`);
    await delayBetweenRequests();
  }

  return [...ids].sort();
}

export function playerUrlForId(playerId) {
  const letter = playerId.charAt(0);
  return `${BBR_BASE}/wnba/players/${letter}/${playerId}.html`;
}
