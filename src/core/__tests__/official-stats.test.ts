import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../analysis/metrics';
import type { Engagement } from '../types';

describe('priorite des chiffres du jeu sur le marquage manuel', () => {
  const engagements: Engagement[] = [{ startS: 10, endS: 40, intensity: 0.6, peak: 0.8 }];
  const base = {
    features: [],
    engagements,
    durationS: 300,
    samplingHz: 3,
    profile: 'domination' as const,
  };

  it('remplace le marquage par la ligne lue a l ecran', () => {
    const marque = computeMetrics({
      ...base,
      events: [
        { id: 'a', t: 12, type: 'kill', source: 'manual', confidence: 1 },
        { id: 'b', t: 30, type: 'death', source: 'manual', confidence: 1 },
      ],
    });
    expect(marque.kills).toBe(1);
    expect(marque.deaths).toBe(1);

    const officiel = computeMetrics({
      ...base,
      events: [
        { id: 'a', t: 12, type: 'kill', source: 'manual', confidence: 1 },
        { id: 'b', t: 30, type: 'death', source: 'manual', confidence: 1 },
      ],
      officialStats: {
        player: 'SYNxKALAS',
        team: 'ALLIANCE',
        score: 700,
        kills: 11,
        deaths: 3,
        assists: 1,
      },
    });
    // Le jeu a ecrit 11/3 a l'ecran : aucun marquage a posteriori ne pese
    // contre ce chiffre.
    expect(officiel.kills).toBe(11);
    expect(officiel.deaths).toBe(3);
    expect(officiel.kd).toBeCloseTo(11 / 3, 5);
  });

  it('accepte une ligne officielle a zero elimination sans retomber sur le marquage', () => {
    const metrics = computeMetrics({
      ...base,
      events: [{ id: 'a', t: 12, type: 'kill', source: 'manual', confidence: 1 }],
      officialStats: {
        player: 'SYNxKALAS',
        team: 'ALLIANCE',
        score: 100,
        kills: 0,
        deaths: 7,
        assists: 0,
      },
    });
    expect(metrics.kills).toBe(0);
    expect(metrics.deaths).toBe(7);
  });
});
