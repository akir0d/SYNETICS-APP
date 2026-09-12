import { describe, expect, it } from 'vitest';
import { computeMetrics, computeScores, formatDuration, longestCalm } from '../analysis/metrics';
import { runLocalAnalysis } from '../analysis/heuristics';
import type { Engagement, MatchEvent } from '../types';
import { syntheticFeatures } from './fixtures';

const ENGAGEMENTS: Engagement[] = [
  { startS: 10, endS: 20, intensity: 0.6, peak: 0.8 },
  { startS: 40, endS: 50, intensity: 0.5, peak: 0.7 },
];

function event(t: number, type: MatchEvent['type'], source: MatchEvent['source']): MatchEvent {
  return { id: `${type}-${t}-${source}`, t, type, source, confidence: 1 };
}

describe('accalmies', () => {
  it('mesure la plus longue periode sans engagement, fin de match comprise', () => {
    // Trous : 10 s au debut, 20 s au milieu, 50 s a la fin.
    expect(longestCalm(ENGAGEMENTS, 100)).toBe(50);
  });

  it('renvoie tout le match quand rien n a ete detecte', () => {
    expect(longestCalm([], 90)).toBe(90);
  });

  it('ne renvoie jamais de duree negative', () => {
    expect(longestCalm(ENGAGEMENTS, 45)).toBeGreaterThanOrEqual(0);
  });
});

describe('compteurs de match', () => {
  const base = {
    features: [],
    engagements: ENGAGEMENTS,
    durationS: 100,
    samplingHz: 2,
    profile: 'tdm' as const,
  };

  it('ne compte comme eliminations que ce qui est marque ou reconnu par l IA', () => {
    const metrics = computeMetrics({
      ...base,
      events: [
        event(12, 'kill', 'manual'),
        event(15, 'kill', 'ai'),
        // Un signal local n'est pas une preuve : il ne doit pas gonfler le K/D.
        event(18, 'kill', 'local'),
        event(45, 'death', 'manual'),
      ],
    });

    expect(metrics.kills).toBe(2);
    expect(metrics.deaths).toBe(1);
    expect(metrics.kd).toBe(2);
  });

  it('compte en revanche les expositions detectees localement', () => {
    const metrics = computeMetrics({
      ...base,
      events: [event(12, 'damage_taken', 'local'), event(30, 'damage_taken', 'local')],
    });
    expect(metrics.exposureEvents).toBe(2);
  });

  it('laisse le K/D vide plutot que d afficher un ratio trompeur', () => {
    const vide = computeMetrics({ ...base, events: [] });
    expect(vide.kd).toBeNull();

    const sansMort = computeMetrics({ ...base, events: [event(12, 'kill', 'manual')] });
    expect(sansMort.kd).toBe(1);
  });

  it('calcule le temps en action et le rythme', () => {
    const metrics = computeMetrics({ ...base, events: [] });
    expect(metrics.activeRatio).toBeCloseTo(0.2, 5);
    expect(metrics.engagementCount).toBe(2);
    expect(metrics.meanEngagementS).toBe(10);
    expect(metrics.tempoPerMin).toBeCloseTo(1.2, 5);
  });
});

describe('scores de profil', () => {
  const commun = { engagements: ENGAGEMENTS, activeSeconds: 20, profile: 'tdm' as const };

  it('reste borne entre 0 et 100', () => {
    const extreme = computeScores({
      ...commun,
      activeRatio: 5,
      tempoPerMin: 50,
      exposureEvents: 500,
    });
    for (const value of Object.values(extreme)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('fait baisser la discipline quand les expositions s accumulent', () => {
    const propre = computeScores({ ...commun, activeRatio: 0.3, tempoPerMin: 2, exposureEvents: 0 });
    const expose = computeScores({ ...commun, activeRatio: 0.3, tempoPerMin: 2, exposureEvents: 2 });
    expect(expose.discipline).toBeLessThan(propre.discipline);
  });

  it('penalise davantage l exposition dans un mode sans reapparition', () => {
    const args = { ...commun, activeRatio: 0.3, tempoPerMin: 2, exposureEvents: 1 };
    const avecRespawn = computeScores(args);
    const sansRespawn = computeScores({ ...args, profile: 'bomb' as const });
    expect(sansRespawn.discipline).toBeLessThan(avecRespawn.discipline);
  });
});

describe('chaine complete sur un signal synthetique', () => {
  it('produit des mesures coherentes de bout en bout', () => {
    const features = syntheticFeatures({
      durationS: 120,
      samplingHz: 2,
      actionWindows: [
        [20, 32],
        [60, 75],
      ],
      redFlashes: [25, 64],
      cuts: [33],
    });
    const local = runLocalAnalysis(features, { samplingHz: 2 });
    const metrics = computeMetrics({
      features,
      engagements: local.engagements,
      events: local.events,
      durationS: 120,
      samplingHz: 2,
      profile: 'tdm',
    });

    expect(metrics.engagementCount).toBe(2);
    expect(metrics.activeRatio).toBeGreaterThan(0.15);
    expect(metrics.activeRatio).toBeLessThan(0.5);
    expect(metrics.exposureEvents).toBe(2);
    expect(metrics.kills).toBe(0);
  });

  it('ne produit ni phase ni score d agressivite sur une video statique', () => {
    const features = syntheticFeatures({
      durationS: 120,
      samplingHz: 2,
      actionWindows: [],
      redFlashes: [],
      cuts: [],
    });
    const local = runLocalAnalysis(features, { samplingHz: 2 });
    const metrics = computeMetrics({
      features,
      engagements: local.engagements,
      events: local.events,
      durationS: 120,
      samplingHz: 2,
      profile: 'tdm',
    });

    expect(metrics.engagementCount).toBe(0);
    expect(metrics.activeRatio).toBe(0);
    expect(metrics.scores.aggression).toBe(0);
    expect(metrics.longestCalmS).toBe(120);
  });
});

describe('formatage', () => {
  it('affiche les durees en mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(600)).toBe('10:00');
  });

  it('degrade proprement une duree invalide', () => {
    expect(formatDuration(Number.NaN)).toBe('--:--');
    expect(formatDuration(-4)).toBe('--:--');
  });
});
