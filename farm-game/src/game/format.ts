const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'aa', 'ab', 'ac', 'ad', 'ae', 'af', 'ag'];

/** 999 -> "999", 1234 -> "1.23K", 45600000 -> "45.6M". */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (n < 0) return '-' + fmt(-n);
  if (n < 1000) return Math.floor(n).toString();
  const tier = Math.floor(Math.log10(n) / 3);
  if (tier >= SUFFIXES.length) return n.toExponential(2);
  // On tronque au lieu d'arrondir : 999 999 reste "999K", jamais "1000K".
  const scaled = n / 1000 ** tier;
  const digits = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  const text = (Math.floor(scaled * 10 ** digits) / 10 ** digits).toFixed(digits);
  return text + SUFFIXES[tier];
}

/** 3500 -> "3,5 s", 125000 -> "2 min 5 s". */
export function fmtDuration(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return `${(Math.ceil(s * 10) / 10).toFixed(1).replace('.', ',')} s`;
  if (s < 60) return `${Math.ceil(s)} s`;
  const total = Math.ceil(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return sec > 0 ? `${m} min ${sec} s` : `${m} min`;
}
