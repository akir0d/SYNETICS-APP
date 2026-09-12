import { describe, expect, it } from 'vitest';
import {
  computeIntensity,
  detectEngagements,
  detectExposure,
  detectSceneCuts,
  DEFAULT_HEURISTICS,
  runLocalAnalysis,
  selectKeyframeTimes,
} from '../analysis/heuristics';
import { syntheticFeatures } from './fixtures';

const BASE = {
  durationS: 120,
  samplingHz: 2,
  actionWindows: [
    [20, 32],
    [60, 75],
    [95, 104],
  ] as Array<[number, number]>,
  redFlashes: [25, 64, 99],
  cuts: [33, 76],
};

describe('moteur d analyse local', () => {
  it('retrouve les phases d action injectees dans le signal', () => {
    const features = syntheticFeatures(BASE);
    const intensity = computeIntensity(features, BASE.samplingHz);
    const engagements = detectEngagements(features, intensity, {
      ...DEFAULT_HEURISTICS,
      samplingHz: BASE.samplingHz,
    });

    expect(engagements).toHaveLength(3);
    // Le lissage elargit legerement les bornes : on verifie le recouvrement,
    // pas une egalite a la milliseconde.
    for (const [i, [from, to]] of BASE.actionWindows.entries()) {
      const found = engagements[i];
      expect(found).toBeDefined();
      expect(found!.startS).toBeLessThanOrEqual(from + 2);
      expect(found!.endS).toBeGreaterThanOrEqual(to - 2);
    }
  });

  it('ne fabrique aucune phase d action sur une video sans rien', () => {
    const features = syntheticFeatures({ ...BASE, actionWindows: [], redFlashes: [], cuts: [] });
    const intensity = computeIntensity(features, BASE.samplingHz);
    expect(detectEngagements(features, intensity, DEFAULT_HEURISTICS)).toEqual([]);
  });

  it('detecte les flashs rouges comme expositions, une seule fois chacun', () => {
    const features = syntheticFeatures(BASE);
    const events = detectExposure(features, { ...DEFAULT_HEURISTICS, samplingHz: BASE.samplingHz });

    expect(events).toHaveLength(BASE.redFlashes.length);
    for (const [i, t] of BASE.redFlashes.entries()) {
      expect(events[i]!.t).toBeCloseTo(t, 1);
      expect(events[i]!.type).toBe('damage_taken');
      expect(events[i]!.source).toBe('local');
    }
  });

  it('voit un flash meme quand le fond est parfaitement stable', () => {
    // Regression : un fond sans aucun bruit annule l ecart absolu median.
    // Un seuil purement relatif renvoie alors un score z de zero pour tout le
    // monde, y compris pour un voile rouge evident, et la detection devient
    // totalement aveugle.
    const step = 1 / 3;
    const features = Array.from({ length: 60 }, (_, i) => ({
      t: i * step,
      luma: 0.3,
      redBias: i === 20 || i === 40 ? 0.45 : 0,
      diff: 0.05,
      saturation: 0.02,
    }));

    const events = detectExposure(features, { ...DEFAULT_HEURISTICS, samplingHz: 3 });
    expect(events).toHaveLength(2);
    expect(events[0]!.t).toBeCloseTo(20 * step, 3);
    expect(events[1]!.t).toBeCloseTo(40 * step, 3);
  });

  it('ne signale rien sur un fond stable sans le moindre flash', () => {
    const features = Array.from({ length: 60 }, (_, i) => ({
      t: i / 3,
      luma: 0.3,
      redBias: 0,
      diff: 0.05,
      saturation: 0.02,
    }));
    expect(detectExposure(features, DEFAULT_HEURISTICS)).toEqual([]);
  });

  it('detecte les coupures franches', () => {
    const features = syntheticFeatures(BASE);
    const cuts = detectSceneCuts(features, DEFAULT_HEURISTICS);
    expect(cuts.length).toBeGreaterThanOrEqual(BASE.cuts.length);
    expect(cuts.every((c) => c.type === 'scene_cut')).toBe(true);
  });

  it('produit une timeline triee et bornee par la duree', () => {
    const features = syntheticFeatures(BASE);
    const { events } = runLocalAnalysis(features, { samplingHz: BASE.samplingHz });

    expect(events.length).toBeGreaterThan(0);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.t).toBeGreaterThanOrEqual(events[i - 1]!.t);
    }
    expect(events.every((e) => e.t >= 0 && e.t <= BASE.durationS)).toBe(true);
    expect(events.every((e) => e.confidence >= 0 && e.confidence <= 1)).toBe(true);
  });

  it('gere une video vide sans planter', () => {
    const result = runLocalAnalysis([], { samplingHz: 2 });
    expect(result.events).toEqual([]);
    expect(result.engagements).toEqual([]);
    expect(result.intensity).toEqual([]);
  });
});

describe('selection des images cles', () => {
  it('respecte le budget et reste dans la duree du match', () => {
    const features = syntheticFeatures(BASE);
    const intensity = computeIntensity(features, BASE.samplingHz);
    const times = selectKeyframeTimes(features, intensity, 12);

    expect(times.length).toBeLessThanOrEqual(12);
    expect(times.length).toBeGreaterThan(0);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
    expect(Math.max(...times)).toBeLessThanOrEqual(BASE.durationS);
  });

  it('renvoie toutes les images quand elles tiennent dans le budget', () => {
    const features = syntheticFeatures({ ...BASE, durationS: 4, samplingHz: 1 });
    expect(selectKeyframeTimes(features, [0, 0, 0, 0], 20)).toHaveLength(features.length);
  });

  it('couvre aussi les phases calmes, pas seulement les pics', () => {
    const features = syntheticFeatures(BASE);
    const intensity = computeIntensity(features, BASE.samplingHz);
    const times = selectKeyframeTimes(features, intensity, 20);

    // La plus longue accalmie du scenario est entre 33 s et 60 s.
    const dansLAccalmie = times.filter((t) => t > 35 && t < 58);
    expect(dansLAccalmie.length).toBeGreaterThan(0);
  });
});
