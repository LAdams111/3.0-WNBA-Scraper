function mapPosition(code) {
  const t = String(code || '')
    .trim()
    .toUpperCase();
  if (!t) return 'G';
  if (t === 'G' || t === 'F' || t === 'C' || t === 'G-F' || t === 'F-C' || t === 'F-G') return t;
  if (t.includes('FORWARD') && t.includes('GUARD')) return 'G-F';
  if (t.includes('FORWARD')) return 'F';
  if (t.includes('CENTER')) return 'C';
  if (t.includes('GUARD')) return 'G';
  return t.slice(0, 4);
}

function buildBdlBio(p) {
  const lines = [];
  if (p.college) lines.push(`College: ${p.college}`);
  if (p.country) lines.push(`Country: ${p.country}`);
  if (Number.isFinite(p.draft_year)) {
    const r = Number.isFinite(p.draft_round) ? ` R${p.draft_round}` : '';
    const n = Number.isFinite(p.draft_number) ? ` #${p.draft_number}` : '';
    lines.push(`Draft: ${p.draft_year}${r}${n}`);
  }
  lines.push(`BallDontLie player id: ${p.id}`);
  return lines.join('\n');
}

function rnd(n) {
  if (n == null || Number.isNaN(Number(n))) return undefined;
  return Math.round(Number(n) * 10) / 10;
}

function num(n) {
  if (n == null || Number.isNaN(Number(n))) return undefined;
  return Math.round(Number(n));
}

/**
 * @param {object} p - row from GET /v1/players
 * @param {object|null} avg - row from GET /v1/season_averages/general … (has .season, .stats, optional .player)
 */
export function toHoopCentralFromBdl(p, avg = null) {
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || `Player ${p.id}`;
  const team = p.team?.full_name || 'Free Agent';
  const seasonYear = new Date().getUTCFullYear();
  const s = avg?.stats || {};
  const seasonNum = avg?.season;
  const seasonLabel =
    seasonNum != null && Number.isFinite(Number(seasonNum)) ? `${seasonNum} NBA` : `${seasonYear} NBA`;

  const teamForHistory = p.team?.full_name || 'Unknown';

  const fgPctPct =
    s.fg_pct != null
      ? Number(s.fg_pct) <= 1
        ? rnd(Number(s.fg_pct) * 100)
        : rnd(s.fg_pct)
      : undefined;

  const seasonHistory =
    avg && Object.keys(s).length
      ? [
          {
            season: String(seasonNum ?? seasonYear),
            league: 'NBA',
            team: teamForHistory,
            gamesPlayed: num(s.gp) ?? 0,
            points: rnd(s.pts) ?? 0,
            rebounds: rnd(s.reb) ?? 0,
            assists: rnd(s.ast) ?? 0,
            blocks: rnd(s.blk) ?? 0,
            steals: rnd(s.stl) ?? 0,
            fieldGoalPercentage: fgPctPct,
          },
        ]
      : [];

  const pts = rnd(s.pts);
  const ast = rnd(s.ast);
  const reb = rnd(s.reb);
  const seasonTrends =
    pts != null && ast != null && reb != null
      ? { points: [pts], assists: [ast], rebounds: [reb] }
      : { points: [], assists: [], rebounds: [] };

  return {
    externalId: `bdl-nba-${p.id}`,
    name,
    headshotUrl: undefined,
    jerseyNumber: p.jersey_number != null && p.jersey_number !== '' ? String(p.jersey_number) : undefined,
    position: mapPosition(p.position),
    team,
    birthDate: undefined,
    hometown: undefined,
    bio: buildBdlBio(p),
    height: p.height || undefined,
    weight: p.weight != null && p.weight !== '' ? String(p.weight) : undefined,
    profileViews: 0,
    stats: {
      season: seasonLabel,
      gamesPlayed: num(s.gp),
      pointsPerGame: rnd(s.pts),
      reboundsPerGame: rnd(s.reb),
      assistsPerGame: rnd(s.ast),
      fieldGoalPercentage: fgPctPct,
      stealsPerGame: rnd(s.stl),
      blocksPerGame: rnd(s.blk),
    },
    seasonHistory,
    seasonTrends,
  };
}
