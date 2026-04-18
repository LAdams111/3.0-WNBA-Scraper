export function brPctToNumber(s) {
  if (s == null || s === '') return null;
  const t = String(s).trim();
  if (t === '' || t === '.') return null;
  const n = parseFloat(t.startsWith('.') ? `0${t}` : t);
  if (Number.isNaN(n)) return null;
  const pct = n <= 1 ? n * 100 : n;
  return Math.round(pct * 10) / 10;
}

export function parseFloatSafe(s) {
  if (s == null || s === '') return null;
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}

export function parseIntSafe(s) {
  if (s == null || s === '') return null;
  const n = parseInt(String(s).replace(/,/g, ''), 10);
  return Number.isNaN(n) ? null : n;
}
