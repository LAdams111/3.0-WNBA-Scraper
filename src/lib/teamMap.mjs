/** Map BR franchise abbrev (season page) to a readable team label for Hoop Central `team` field. */
export const WNBA_TEAM_LABEL = {
  ATL: 'Atlanta Dream',
  CHI: 'Chicago Sky',
  CON: 'Connecticut Sun',
  DAL: 'Dallas Wings',
  GSV: 'Golden State Valkyries',
  IND: 'Indiana Fever',
  LVA: 'Las Vegas Aces',
  LAS: 'Los Angeles Sparks',
  MIN: 'Minnesota Lynx',
  NYL: 'New York Liberty',
  PHO: 'Phoenix Mercury',
  SEA: 'Seattle Storm',
  WAS: 'Washington Mystics',
  CHA: 'Charlotte Sting',
  CLE: 'Cleveland Rockers',
  DET: 'Detroit Shock',
  HOU: 'Houston Comets',
  LAS2: 'Los Angeles Sparks',
  MIA: 'Miami Sol',
  POR: 'Portland Fire',
  SAC: 'Sacramento Monarchs',
  UTA: 'Utah Starzz',
  SAN: 'San Antonio Stars',
  SAS: 'San Antonio Stars',
  TUL: 'Tulsa Shock',
  ORL: 'Orlando Miracle',
  CHS: 'Chicago Sky',
  WNB: 'WNBA',
  TOT: 'Multiple Teams',
};

export function teamLabelFromAbbrev(abbr) {
  if (!abbr || abbr === '') return 'WNBA — Unknown';
  const k = String(abbr).trim().toUpperCase();
  if (k === 'TOT' || k.startsWith('TM')) return 'Multiple Teams';
  return WNBA_TEAM_LABEL[k] || k;
}
