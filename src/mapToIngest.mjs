import { teamLabelFromAbbrev } from './lib/teamMap.mjs';
import { brPctToNumber, parseFloatSafe, parseIntSafe } from './lib/statHelpers.mjs';
import {
  buildBio,
  buildSeasonHistory,
  buildSeasonTrends,
  pickLatestSeasonRow,
} from './parsePlayerPage.mjs';

function wnbaSeasonLabel(year) {
  if (!Number.isFinite(year)) return 'WNBA';
  return `${year} WNBA`;
}

export function toHoopCentralPlayer(parsed, brPlayerId) {
  const latest = pickLatestSeasonRow(parsed.seasonsPerGame);
  const teamAbbr = latest ? abbrevFromCell(latest.team) : '';
  const team = teamLabelFromAbbrev(teamAbbr);

  const year = latest ? parseInt(latest.year, 10) : null;

  const rnd = (n) => {
    if (n == null || Number.isNaN(n)) return undefined;
    return Math.round(n * 10) / 10;
  };

  const stats = latest
    ? {
        season: wnbaSeasonLabel(year),
        gamesPlayed: parseIntSafe(latest.g) ?? undefined,
        pointsPerGame: rnd(parseFloatSafe(latest.pts_per_g)),
        reboundsPerGame: rnd(parseFloatSafe(latest.trb_per_g)),
        assistsPerGame: rnd(parseFloatSafe(latest.ast_per_g)),
        fieldGoalPercentage: brPctToNumber(latest.fg_pct) ?? undefined,
        stealsPerGame: rnd(parseFloatSafe(latest.stl_per_g)),
        blocksPerGame: rnd(parseFloatSafe(latest.blk_per_g)),
      }
    : {
        season: 'WNBA',
      };

  const seasonHistory = buildSeasonHistory(parsed);
  const seasonTrends = buildSeasonTrends(parsed);

  const record = {
    externalId: `br-wnba-${brPlayerId}`,
    name: parsed.displayName || parsed.fullLegalName || brPlayerId,
    headshotUrl: parsed.headshotUrl || undefined,
    jerseyNumber: parsed.jerseyNumber ?? undefined,
    position: parsed.positionCode,
    team,
    birthDate: parsed.birthIso || undefined,
    hometown: parsed.hometown || undefined,
    bio: buildBio(parsed, brPlayerId),
    height: parsed.height || undefined,
    weight: parsed.weight || undefined,
    profileViews: 0,
    stats,
    seasonHistory,
    seasonTrends,
  };

  return record;
}

function abbrevFromCell(raw) {
  const t = String(raw || '').trim();
  const m = t.match(/\b([A-Z]{2,4})\b/);
  return m ? m[1].toUpperCase() : t.slice(0, 4).toUpperCase();
}
