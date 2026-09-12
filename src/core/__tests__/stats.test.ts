import { describe, expect, it } from 'vitest';
import {
  clamp01,
  mad,
  mean,
  median,
  movingAverage,
  normalizeRobust,
  percentile,
  robustZ,
  stdDev,
} from '../analysis/stats';

describe('statistiques robustes', () => {
  it('calcule la mediane sur un nombre pair et impair de valeurs', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('resiste aux valeurs extremes la ou l ecart-type explose', () => {
    const calme = [1, 1, 1, 1, 1, 1, 1, 1];
    const avecPic = [...calme, 1000];
    // Un seul pic multiplie l'ecart-type par plusieurs centaines...
    expect(stdDev(avecPic)).toBeGreaterThan(stdDev(calme) + 100);
    // ...mais laisse le MAD a zero : c'est exactement ce qu'on veut pour
    // qu'un flash isole ne relève pas le seuil de detection de tout le match.
    expect(mad(avecPic)).toBe(0);
  });

  it('borne les percentiles aux extremites', () => {
    const xs = [10, 20, 30, 40, 50];
    expect(percentile(xs, 0)).toBe(10);
    expect(percentile(xs, 100)).toBe(50);
    expect(percentile(xs, 50)).toBe(30);
  });

  it('lisse sans decaler la serie', () => {
    const lisse = movingAverage([0, 10, 0, 10, 0], 3);
    expect(lisse).toHaveLength(5);
    expect(lisse[2]).toBeCloseTo(20 / 3, 5);
  });

  it('normalise entre 0 et 1 et neutralise une serie plate', () => {
    const norm = normalizeRobust([0, 5, 10]);
    expect(Math.min(...norm)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...norm)).toBeLessThanOrEqual(1);
    expect(normalizeRobust([7, 7, 7])).toEqual([0, 0, 0]);
  });

  it('renvoie des scores z nuls quand il n y a aucune dispersion', () => {
    expect(robustZ([2, 2, 2, 2])).toEqual([0, 0, 0, 0]);
  });

  it('expose des utilitaires coherents', () => {
    expect(mean([2, 4])).toBe(3);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
  });
});
