/** Petites statistiques robustes utilisees par le moteur d'analyse. */

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Ecart absolu median, mis a l'echelle pour approcher un ecart-type.
 * Beaucoup plus stable que l'ecart-type sur une video : un seul flash
 * tres brillant ne fait pas exploser le seuil de detection.
 */
export function mad(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = clamp(Math.round((p / 100) * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx] as number;
}

export function stdDev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

/** Moyenne glissante centree, fenetre en nombre d'echantillons. */
export function movingAverage(xs: readonly number[], window: number): number[] {
  if (window <= 1 || xs.length === 0) return [...xs];
  const half = Math.floor(window / 2);
  const out: number[] = new Array(xs.length);
  for (let i = 0; i < xs.length; i++) {
    const from = Math.max(0, i - half);
    const to = Math.min(xs.length - 1, i + half);
    let s = 0;
    for (let j = from; j <= to; j++) s += xs[j] as number;
    out[i] = s / (to - from + 1);
  }
  return out;
}

/**
 * Ramene une serie sur 0..1 en s'appuyant sur les percentiles 5 et 95,
 * pour que quelques valeurs extremes n'ecrasent pas toute l'echelle.
 */
export function normalizeRobust(xs: readonly number[]): number[] {
  const lo = percentile(xs, 5);
  const hi = percentile(xs, 95);
  const span = hi - lo;
  if (span <= 1e-9) return xs.map(() => 0);
  return xs.map((x) => clamp01((x - lo) / span));
}

/** Score z robuste (base sur mediane / MAD). Renvoie 0 si la serie est plate. */
export function robustZ(xs: readonly number[]): number[] {
  const m = median(xs);
  const d = mad(xs);
  if (d <= 1e-9) return xs.map(() => 0);
  return xs.map((x) => (x - m) / d);
}

/**
 * Mediane glissante centree, fenetre en nombre d'echantillons.
 *
 * Contrairement a la moyenne glissante, un pic bref ne deplace pas le
 * resultat : c'est ce qui permet de mesurer le fond d'une scene sans que
 * l'evenement qu'on cherche a detecter ne vienne relever sa propre reference.
 */
export function movingMedian(xs: readonly number[], window: number): number[] {
  if (window <= 1 || xs.length === 0) return [...xs];
  const half = Math.floor(window / 2);
  const out: number[] = new Array(xs.length);
  for (let i = 0; i < xs.length; i++) {
    const from = Math.max(0, i - half);
    const to = Math.min(xs.length - 1, i + half);
    out[i] = median(xs.slice(from, to + 1));
  }
  return out;
}
