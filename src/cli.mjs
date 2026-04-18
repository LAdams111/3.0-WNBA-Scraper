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
    ? Math.max(1, Math.min(32, parseInt(concArg, 10)))
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
    `Each line below = one player page finished (ok or error). [n/total] is how many have finished, not "only n in DB".`
  );

  let finished = 0;
  const t0 = Date.now();
  const raw = await poolMap(slice, conc, async (id) => {
    let label = id;
    try {
      const url = playerUrlForId(id);
      const html = await fetchText(url);
      const parsed = parsePlayerHtml(html, url);
      const row = toHoopCentralPlayer(parsed, id);
      label = row.name;
      return { id, url, row };
    } catch (e) {
      label = `ERROR ${e.message}`;
      throw e;
    } finally {
      finished++;
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      const isErr = String(label).startsWith('ERROR');
      const line = `  [${finished}/${slice.length}] ${label} (${sec}s)`;
      if (isErr || finished % logEvery === 0 || finished === slice.length) {
        flushLine(line);
      }
    }
  });

  const players = [];
  const errors = [];
  for (let i = 0; i < raw.length; i++) {
    const slot = raw[i];
    const id = slice[i];
    const url = playerUrlForId(id);
    if (!slot.ok) {
      errors.push({ id, url, message: slot.error?.message || String(slot.error) });
      continue;
    }
    players.push(slot.value.row);
  }

  const elapsedMs = Math.max(1, Date.now() - t0);
  log(
    `Player fetch wall time: ${(elapsedMs / 1000).toFixed(1)}s (${((slice.length / elapsedMs) * 1000).toFixed(2)} pages/s avg).`
  );

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify({ players, errors }, null, 2), 'utf8');
  log(`\nWrote ${players.length} players to ${outPath}`);
  if (errors.length) log(`Errors: ${errors.length} (see "errors" in JSON).`);
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
  const { players } = JSON.parse(raw);
  if (!Array.isArray(players)) throw new Error('Invalid JSON: expected { players: [] }');

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
  node src/cli.mjs scrape [--limit N] [--out path.json] [--concurrency 1-32] [--fast]
  node src/cli.mjs ingest [--file path.json]

  --fast  use FAST_DISCOVER=1-style short index (dev only; omitted on npm start)
`);
  process.exit(1);
}
