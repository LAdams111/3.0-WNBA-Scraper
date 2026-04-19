#!/usr/bin/env node
import 'dotenv/config';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { fetchAllBdlPlayers } from './fetchBdlPlayers.mjs';
import { pooledFetch } from './lib/http.mjs';
import { poolMap } from './lib/pool.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function argValue(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

async function scrape() {
  const log = console.log;
  const outPath = argValue('--out') || join(ROOT, 'output', 'nba-players-ingest.json');
  const limitArg = argValue('--limit');
  const limitFromEnv = process.env.SCRAPE_LIMIT ? parseInt(process.env.SCRAPE_LIMIT, 10) : null;
  const maxPlayers = limitArg
    ? parseInt(limitArg, 10)
    : Number.isFinite(limitFromEnv)
      ? limitFromEnv
      : null;

  log(
    'Step 1/2: Ball Dont Lie — listing players, then season stats (can take many minutes). Nothing is POSTed to your site yet.'
  );
  const players = await fetchAllBdlPlayers(log);
  const slice = Number.isFinite(maxPlayers) ? players.slice(0, maxPlayers) : players;
  if (Number.isFinite(maxPlayers)) log(`Applying limit: ${slice.length} of ${players.length} players.`);

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify({ players: slice, errors: [] }, null, 2), 'utf8');
  log(`\nStep 1 complete: wrote ${slice.length} players to ${outPath}`);
  log(
    'If you ran npm start, Step 2 (ingest to Mongo via Hoop Central) runs next — watch for "Ingesting …" below.'
  );
}

function ingestTargetLabel(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '(invalid HOOP_CENTRAL_INGEST_URL)';
  }
}

async function ingest() {
  const path = argValue('--file') || join(ROOT, 'output', 'nba-players-ingest.json');
  const url = process.env.HOOP_CENTRAL_INGEST_URL;
  const key = process.env.INGEST_API_KEY;
  if (!url || !key) {
    console.error('Set HOOP_CENTRAL_INGEST_URL and INGEST_API_KEY (see .env.example).');
    process.exit(1);
  }

  console.log(`\nStep 2/2: Ingest → ${ingestTargetLabel(url)}`);
  console.log(`Reading ${path}`);

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
  node src/cli.mjs scrape [--limit N] [--out path.json]
  node src/cli.mjs ingest [--file path.json]

  Requires BALLDONTLIE_API_KEY. Data source: api.balldontlie.io (NBA), not WNBA/BR.
`);
  process.exit(1);
}
