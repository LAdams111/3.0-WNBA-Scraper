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

/**
 * Map a Ball Dont Lie `GET /v1/players` row to Hoop Central ingest shape.
 * Season game stats are omitted unless you extend fetch with season_averages.
 */
export function toHoopCentralFromBdl(p) {
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || `Player ${p.id}`;
  const team = p.team?.full_name || 'Free Agent';
  const seasonYear = new Date().getUTCFullYear();

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
      season: `${seasonYear} NBA`,
    },
    seasonHistory: [],
    seasonTrends: { points: [], assists: [], rebounds: [] },
  };
}
