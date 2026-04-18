#!/usr/bin/env node
import 'dotenv/config';
import { writeSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { discoverAllPlayerIds, playerUrlForId } from './discoverPlayers.mjs';
import { playerConcurrency } from './lib/concurrency.mjs';
import { fetchText, pooledFetch } from './lib/http.mjs';
import { poolMap } from './lib/pool.mjs';
import { parsePlayerHtml } from './parsePlayerPage.mjs';
import { toHoopCentralPlayer } from './mapToIngest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function argValue(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function isTerminalScrapeError(err) {
  const msg = err?.message || String(err);
  return /HTTP 404\b/.test(msg) || /HTTP 410\b/.test(msg);
}

async function scrape() {
  const log = console.log;
  const outPath = argValue('--out') || join(ROOT, 'output', 'wnba-players-ingest.json');
  const limitArg = argValue('--limit');
  const limitFromEnv = process.env.SCRAPE_LIMIT ? parseInt(process.env.SCRAPE_LIMIT, 10) : null;

  // `npm start` / Railway: full a–z discovery + all players. `--fast` = main index only (dev).
  if (hasFlag('--fast')) {
    process.env.FAST_DISCOVER = '1';
  } else {
    delete process.env.FAST_DISCOVER;
    delete process.env.SCRAPE_LIMIT;
  }

  const maxPlayers = limitArg
    ? parseInt(limitArg, 10)
    : Number.isFinite(limitFromEnv)
      ? limitFromEnv
      : null;

  const ids = await discoverAllPlayerIds(log);
  log(`Discovered ${ids.length} player pages.`);

  const slice = Number.isFinite(maxPlayers) ? ids.slice(0, maxPlayers) : ids;
  if (Number.isFinite(maxPlayers)) log(`Scraping first ${slice.length} players (limit).`);

  const concArg = argValue('--concurrency');
  const conc = concArg
    ? Math.max(1, Math.min(16, parseInt(concArg, 10)))
    : playerConcurrency();
  const logEveryRaw = parseInt(process.env.SCRAPING_LOG_EVERY || '1', 10);
  const logEvery = Number.isFinite(logEveryRaw) && logEveryRaw > 0 ? Math.min(200, logEveryRaw) : 1;

  function flushLine(line) {
    try {
      writeSync(1, `${line}\n`);
    } catch {
      log(line);
    }
  }

  log(`Fetching player pages with concurrency=${conc} (set CONCURRENCY on Railway).`);
  flushLine(
    `[n/total] counts only successful scrapes. Retryable failures are retried until ok (nothing skipped).`
  );

  const roundPauseMs = Math.max(
    0,
    parseInt(process.env.SCRAPER_ROUND_PAUSE_MS || '1500', 10) || 0
  );

  const playersById = new Map();
  let pending = [...slice];
  const t0 = Date.now();
  let round = 0;
  let attemptSeq = 0;

  while (pending.length > 0) {
    round++;
    log(
      `\nScrape round ${round}: ${pending.length} pending, ${playersById.size}/${slice.length} succeeded.`
    );

    const raw = await poolMap(pending, conc, async (id) => {
      const url = playerUrlForId(id);
      const html = await fetchText(url);
      const parsed = parsePlayerHtml(html, url);
      const row = toHoopCentralPlayer(parsed, id);
      return { id, url, row };
    });

    const nextPending = [];
    for (let i = 0; i < raw.length; i++) {
      const id = pending[i];
      const slot = raw[i];
      const sec = ((Date.now() - t0) / 1000).toFixed(1);

      if (slot.ok) {
        playersById.set(id, slot.value.row);
        const n = playersById.size;
        const line = `  [${n}/${slice.length}] ${slot.value.row.name} (${sec}s)`;
        if (n === 1 || n % logEvery === 0 || n === slice.length) {
          flushLine(line);
        }
        continue;
      }

      const err = slot.error;
      if (isTerminalScrapeError(err)) {
        const url = playerUrlForId(id);
        console.error(`\nPermanent failure for ${id} (${url}): ${err?.message || err}`);
        console.error('Fix or remove this id from discovery; exiting without writing output.');
        process.exit(1);
      }

      attemptSeq++;
      flushLine(
        `  [retry] ${id}: ${err?.message || err} — not counted toward ${slice.length} (${sec}s, attempt ${attemptSeq})`
      );
      nextPending.push(id);
    }

    pending = nextPending;
    if (pending.length > 0 && roundPauseMs > 0) {
      await new Promise((r) => setTimeout(r, roundPauseMs));
    }
  }

  const players = slice.map((id) => {
    const row = playersById.get(id);
    if (!row) throw new Error(`Internal error: missing row for ${id}`);
    return row;
  });

  const elapsedMs = Math.max(1, Date.now() - t0);
  log(
    `Player fetch wall time: ${(elapsedMs / 1000).toFixed(1)}s (${((slice.length / elapsedMs) * 1000).toFixed(2)} pages/s avg).`
  );

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    JSON.stringify({ players, errors: [] }, null, 2),
    'utf8'
  );
  log(`\nWrote ${players.length} players to ${outPath} (all ${slice.length} scraped; none skipped).`);
}

async function ingest() {
  const path = argValue('--file') || join(ROOT, 'output', 'wnba-players-ingest.json');
  const url = process.env.HOOP_CENTRAL_INGEST_URL;
  const key = process.env.INGEST_API_KEY;
  if (!url || !key) {
    console.error('Set HOOP_CENTRAL_INGEST_URL and INGEST_API_KEY (see .env.example).');
    process.exit(1);
  }

  const raw = await import('fs/promises').then((fs) => fs.readFile(path, 'utf8'));
  const data = JSON.parse(raw);
  const { players } = data;
  if (!Array.isArray(players)) throw new Error('Invalid JSON: expected { players: [] }');
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    console.error(
      `Refusing ingest: ${data.errors.length} scrape error(s) in JSON. Re-run scrape until errors is empty.`
    );
    process.exit(1);
  }

  const chunkSize = Math.max(
    1,
    parseInt(process.env.INGEST_CHUNK_SIZE || String(players.length), 10) || players.length
  );
  const chunks = [];
  for (let i = 0; i < players.length; i += chunkSize) {
    chunks.push(players.slice(i, i + chunkSize));
  }
  const ingestConcRaw = parseInt(process.env.INGEST_CONCURRENCY || '6', 10);
  const ingestConc = Math.min(
    10,
    Math.max(1, Number.isFinite(ingestConcRaw) ? ingestConcRaw : 6),
    chunks.length
  );
  console.log(
    `Ingesting ${players.length} players in ${chunks.length} batch(es), up to ${ingestConc} parallel POSTs…`
  );
  const batchResults = await poolMap(chunks, ingestConc, async (batch, bi) => {
    const res = await pooledFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': key,
      },
      body: JSON.stringify({ players: batch }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
    return { bi, text };
  });
  for (const slot of batchResults) {
    if (!slot.ok) {
      console.error('Ingest batch failed:', slot.error?.message || slot.error);
      process.exit(1);
    }
    console.log(`Batch ${slot.value.bi + 1}:`, slot.value.text);
  }
  console.log('Ingest complete.');
}

const cmd = process.argv[2];
if (cmd === 'scrape') await scrape();
else if (cmd === 'ingest') await ingest();
else {
  console.log(`Usage:
  node src/cli.mjs scrape [--limit N] [--out path.json] [--concurrency 1-16] [--fast]
  node src/cli.mjs ingest [--file path.json]

  --fast  use FAST_DISCOVER=1-style short index (dev only; omitted on npm start)
`);
  process.exit(1);
}
