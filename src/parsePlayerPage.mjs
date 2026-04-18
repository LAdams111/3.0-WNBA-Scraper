import { load } from 'cheerio';
import { brPctToNumber, parseFloatSafe, parseIntSafe } from './lib/statHelpers.mjs';
import { teamLabelFromAbbrev } from './lib/teamMap.mjs';

function clean(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function rowToStatMap($, tr) {
  const o = {};
  $(tr)
    .find('[data-stat]')
    .each((_, td) => {
      const k = $(td).attr('data-stat');
      if (!k) return;
      o[k] = clean($(td).text());
    });
  return o;
}

function parseJsonLdPerson(html) {
  const re = /<script type="application\/ld\+json">\s*(\{[\s\S]*?\})\s*<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      const j = JSON.parse(m[1]);
      if (j['@type'] === 'Person') return j;
    } catch {
      /* try next block */
    }
  }
  return null;
}

function mapPosition(brText) {
  const t = clean(brText).toLowerCase();
  if (!t) return 'G';
  if (t.includes('center')) return 'C';
  if (t.includes('forward') && t.includes('guard')) return 'G-F';
  if (t.includes('forward')) return 'F';
  if (t.includes('guard')) return 'G';
  return t.slice(0, 4).toUpperCase();
}

function heightToFeetInches(h) {
  if (!h) return '';
  const s = String(h).replace(/″|"/g, '"').replace(/′|'/g, "'");
  if (s.includes("'")) return s;
  const m = String(h).match(/^(\d)-(\d{1,2})$/);
  if (m) return `${m[1]}'${m[2]}"`;
  return h;
}

export function parsePlayerHtml(html, sourceUrl) {
  const $ = load(html);
  const ld = parseJsonLdPerson(html);

  const h1 = clean($('#info #meta h1 span').first().text()) || ld?.name || '';
  const fullName =
    clean($('#info #meta p strong strong').first().text()) ||
    clean($('#info #meta p strong').first().text()) ||
    h1;

  const metaPs = $('#info #meta p')
    .toArray()
    .map((el) => clean($(el).text()))
    .filter(Boolean);

  let positionText = '';
  let shoots = '';
  for (const line of metaPs) {
    if (!line.includes('Position:')) continue;
    const afterPos = line.replace(/^[\s\S]*?Position:\s*/i, '');
    const beforeShoots = afterPos.split(/Shoots:/i)[0];
    positionText = clean(
      beforeShoots.replace(/[·•▪\u9642]+/g, ' ')
    );
    const sh = line.match(/Shoots:\s*([A-Za-z]+)/i);
    if (sh) shoots = sh[1];
  }

  const hwP = $('#info #meta p span').filter((_, el) => $(el).text().match(/\d+-\d+/)).first().parent();
  let heightRaw = '';
  let weightRaw = '';
  if (hwP.length) {
    const spans = hwP.find('span').toArray();
    if (spans[0]) heightRaw = clean($(spans[0]).text());
    if (spans[1]) weightRaw = clean($(spans[1]).text());
  }

  const birthIso = clean($('#necro-birth').attr('data-birth')) || ld?.birthDate || '';
  const bornLine = $('#info #meta p')
    .filter((_, el) => $(el).html()?.includes('Born:'))
    .first()
    .text();
  let hometown = '';
  const hm = bornLine.match(/in\s+(.+)$/i);
  if (hm) hometown = clean(hm[1]).replace(/\s+us\s*$/i, '').trim();

  let college = '';
  $('#info #meta p').each((_, el) => {
    const t = clean($(el).text());
    if (t.startsWith('College:')) college = clean(t.replace(/^College:/i, ''));
  });

  let highSchool = '';
  $('#info #meta p').each((_, el) => {
    const t = clean($(el).text());
    if (t.startsWith('High School:')) highSchool = clean(t.replace(/^High School:/i, ''));
  });

  let headshot = clean($('#info #meta .media-item img').attr('src'));
  if (!headshot && ld?.image?.contentUrl) headshot = String(ld.image.contentUrl);

  const nicknames = metaPs.filter((l) => /^\([^)]+\)$/.test(l));

  const tableRows = (tableId) => {
    const rows = [];
    const $tbl = $(`table#${tableId}`);
    if (!$tbl.length) return rows;
    $tbl.find('tbody tr.full_table').each((_, tr) => {
      rows.push(rowToStatMap($, tr));
    });
    return rows;
  };

  const perGame = tableRows('per_game0');
  const totals = tableRows('totals0');
  const advanced = tableRows('advanced0');
  const shooting = tableRows('shooting0');
  const per36 = tableRows('per_minute0');
  const per100 = tableRows('per_poss0');
  const pbp = tableRows('pbp0');

  const jerseyMatch = html.match(/data-uni="(\d+)"/);
  const jerseyNumber = jerseyMatch ? parseInt(jerseyMatch[1], 10) : null;

  const heightStr =
    heightToFeetInches(ld?.height?.value || heightRaw) ||
    heightToFeetInches(heightRaw) ||
    '';
  const weightStr = ld?.weight?.value
    ? String(ld.weight.value)
    : weightRaw
      ? weightRaw.replace(/lb$/i, '').trim() + ' lbs'
      : '';

  return {
    sourceUrl,
    displayName: h1 || fullName,
    fullLegalName: fullName,
    nicknames,
    positionText,
    positionCode: mapPosition(positionText),
    shoots,
    height: heightStr,
    weight: weightStr,
    birthIso,
    hometown: hometown || (ld?.birthPlace ? String(ld.birthPlace) : ''),
    college,
    highSchool,
    headshotUrl: headshot.startsWith('http') ? headshot : headshot ? `https://www.basketball-reference.com${headshot}` : '',
    jerseyNumber: Number.isFinite(jerseyNumber) ? jerseyNumber : null,
    seasonsPerGame: perGame,
    seasonsTotals: totals,
    seasonsAdvanced: advanced,
    seasonsShooting: shooting,
    seasonsPer36: per36,
    seasonsPer100Poss: per100,
    seasonsPlayByPlay: pbp,
  };
}

export function buildBio(parsed, brPlayerId) {
  const lines = [];
  lines.push(`[WNBA profile — Basketball-Reference]`);
  lines.push(`BR player id: ${brPlayerId}`);
  if (parsed.fullLegalName && parsed.fullLegalName !== parsed.displayName) {
    lines.push(`Full name: ${parsed.fullLegalName}`);
  }
  if (parsed.nicknames?.length) lines.push(`Also known as: ${parsed.nicknames.join(' | ')}`);
  lines.push(`Position (BR): ${parsed.positionText || '—'}`);
  if (parsed.shoots) lines.push(`Shoots: ${parsed.shoots}`);
  if (parsed.college) lines.push(`College: ${parsed.college}`);
  if (parsed.highSchool) lines.push(`High school: ${parsed.highSchool}`);
  lines.push(`Source: ${parsed.sourceUrl}`);

  const fmtSeason = (label, rows) => {
    if (!rows?.length) return;
    const last = rows[rows.length - 1];
    const keys = Object.keys(last).filter((k) => k !== 'year' && k !== 'team' && last[k] && last[k] !== '');
    if (!keys.length) return;
    lines.push('');
    lines.push(`${label} (most recent season row on BR):`);
    lines.push(
      keys
        .slice(0, 40)
        .map((k) => `${k}=${last[k]}`)
        .join(' | ')
    );
    if (keys.length > 40) lines.push(`… +${keys.length - 40} more columns`);
  };

  fmtSeason('Totals', parsed.seasonsTotals);
  fmtSeason('Advanced', parsed.seasonsAdvanced);
  fmtSeason('Shooting', parsed.seasonsShooting);
  fmtSeason('Per 36', parsed.seasonsPer36);
  fmtSeason('Per 100 poss', parsed.seasonsPer100Poss);
  fmtSeason('Play-by-play', parsed.seasonsPlayByPlay);

  const lastPg = pickLatestSeasonRow(parsed.seasonsPerGame);
  if (lastPg && Object.keys(lastPg).length) {
    lines.push('');
    lines.push('Per game (latest season, all BR columns):');
    lines.push(
      Object.entries(lastPg)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')
    );
  }

  return lines.join('\n');
}

export function pickLatestSeasonRow(rows) {
  if (!rows?.length) return null;
  const withYear = rows
    .map((r) => ({ r, y: parseInt(r.year, 10) }))
    .filter((x) => Number.isFinite(x.y));
  if (!withYear.length) return rows[rows.length - 1];
  withYear.sort((a, b) => a.y - b.y);
  return withYear[withYear.length - 1].r;
}

function r1(n) {
  if (n == null || Number.isNaN(n)) return 0;
  return Math.round(n * 10) / 10;
}

export function buildSeasonHistory(parsed) {
  const out = [];
  for (const r of parsed.seasonsPerGame) {
    const year = parseInt(r.year, 10);
    if (!Number.isFinite(year)) continue;
    const teamAbbr = String(r.team || '')
      .trim()
      .slice(0, 4)
      .toUpperCase();
    out.push({
      season: `${year}`,
      league: 'WNBA',
      team: teamLabelFromAbbrev(teamAbbr),
      gamesPlayed: parseIntSafe(r.g) ?? 0,
      points: r1(parseFloatSafe(r.pts_per_g)),
      rebounds: r1(parseFloatSafe(r.trb_per_g)),
      assists: r1(parseFloatSafe(r.ast_per_g)),
      blocks: r1(parseFloatSafe(r.blk_per_g)),
      steals: r1(parseFloatSafe(r.stl_per_g)),
      fieldGoalPercentage: brPctToNumber(r.fg_pct),
    });
  }
  return out;
}

export function buildSeasonTrends(parsed) {
  const rows = parsed.seasonsPerGame
    .map((r) => ({
      y: parseInt(r.year, 10),
      pts: parseFloat(r.pts_per_g),
      ast: parseFloat(r.ast_per_g),
      reb: parseFloat(r.trb_per_g),
    }))
    .filter(
      (x) =>
        Number.isFinite(x.y) &&
        Number.isFinite(x.pts) &&
        Number.isFinite(x.ast) &&
        Number.isFinite(x.reb)
    );
  rows.sort((a, b) => a.y - b.y);
  const tail = rows.slice(-7);
  const q = (v) => Math.round(v * 10) / 10;
  return {
    points: tail.map((x) => q(x.pts)),
    assists: tail.map((x) => q(x.ast)),
    rebounds: tail.map((x) => q(x.reb)),
  };
}
