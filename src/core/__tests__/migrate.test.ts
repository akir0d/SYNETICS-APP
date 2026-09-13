import { describe, expect, it } from 'vitest';
import { normalizeAnalysis } from '../storage/migrate';
import type { MatchAnalysis } from '../types';

/**
 * Forme exacte d'une analyse ecrite par la version precedente : ni decoupage,
 * ni arene, ni description d'environnement.
 */
const HERITEE = {
  id: 'ancienne-1',
  title: 'Domination — mardi',
  createdAt: '2026-08-01T20:00:00.000Z',
  updatedAt: '2026-08-01T20:05:00.000Z',
  profile: 'domination' as const,
  video: {
    name: 'match.mp4',
    sizeBytes: 5000,
    durationS: 610,
    width: 1920,
    height: 1080,
    mimeType: 'video/mp4',
  },
  settings: { samplingHz: 2, aiEnabled: true, aiModel: 'claude-opus-5', aiFrameBudget: 24 },
  features: [{ t: 0, luma: 0.4, redBias: 0.02, diff: 0.1, saturation: 0.05 }],
  events: [],
  metrics: {
    durationS: 610,
    sampledFrames: 1220,
    samplingHz: 2,
    engagements: [],
    engagementCount: 4,
    activeRatio: 0.3,
    meanEngagementS: 12,
    longestCalmS: 60,
    tempoPerMin: 0.4,
    exposureEvents: 5,
    kills: 2,
    deaths: 1,
    objectives: 0,
    kd: 2,
    scores: { aggression: 50, consistency: 60, discipline: 70, tempo: 20 },
  },
  ai: {
    model: 'claude-opus-5',
    generatedAt: '2026-08-01T20:05:00.000Z',
    framesUsed: 24,
    summary: 'Bonne manche.',
    strengths: ['Placement'],
    weaknesses: ['Rechargements'],
    drills: [],
    timeline: [],
    caveats: 'Images echantillonnees.',
  },
  notes: 'RAS',
} as unknown as Partial<MatchAnalysis> & { id: string };

describe('analyses enregistrees par une version anterieure', () => {
  const migree = normalizeAnalysis(HERITEE);

  it('reste affichable : tous les champs lus par l interface existent', () => {
    // Regression : sans cette normalisation, l'interface lisait `map.mapName`
    // sur `undefined` et l'application entiere restait blanche au demarrage,
    // pour quiconque avait deja une bibliotheque.
    expect(migree.map).toBeDefined();
    expect(migree.map.mapName).toBe('');
    expect(migree.map.mapId).toBeNull();
    expect(migree.map.confirmed).toBe(false);
    expect(migree.outcome).toBe('inconnue');
    expect(migree.segmentIndex).toBe(1);
    expect(migree.segmentCount).toBe(1);
    expect(migree.sourceOffsetS).toBe(0);
    expect(migree.sessionId).toContain('ancienne-1');
  });

  it('considere que le fichier ne contenait qu un match', () => {
    // Avant le decoupage, la duree du match etait celle du fichier.
    expect(migree.video.sourceDurationS).toBe(610);
    expect(migree.video.durationS).toBe(610);
  });

  it('ne touche a rien de ce qui existait deja', () => {
    expect(migree.title).toBe('Domination — mardi');
    expect(migree.metrics.kd).toBe(2);
    expect(migree.metrics.engagementCount).toBe(4);
    expect(migree.features).toHaveLength(1);
    expect(migree.notes).toBe('RAS');
    expect(migree.ai?.summary).toBe('Bonne manche.');
  });

  it('n invente pas de rapport IA la ou il n y en avait pas', () => {
    const sansIa = normalizeAnalysis({ ...HERITEE, ai: undefined });
    expect(sansIa.ai).toBeUndefined();
  });

  it('survit a un enregistrement gravement incomplet', () => {
    // Ceinture et bretelles : un enregistrement tronque ne doit pas faire
    // tomber la bibliotheque entiere.
    const minimal = normalizeAnalysis({ id: 'debris' });
    expect(minimal.title).toBeTruthy();
    expect(minimal.video.durationS).toBe(0);
    expect(minimal.metrics.scores.aggression).toBe(0);
    expect(minimal.events).toEqual([]);
    expect(minimal.map.mapId).toBeNull();
  });

  it('laisse intacte une analyse deja au format courant', () => {
    const moderne = normalizeAnalysis({
      ...HERITEE,
      sourceOffsetS: 900,
      segmentIndex: 3,
      segmentCount: 8,
      sessionId: 'session-42',
      map: { mapId: 'm1', mapName: 'Hangar', confidence: 1, confirmed: true, distance: 0.05 },
      video: { ...HERITEE.video!, sourceDurationS: 10800 },
    } as Partial<MatchAnalysis> & { id: string });

    expect(moderne.sourceOffsetS).toBe(900);
    expect(moderne.segmentIndex).toBe(3);
    expect(moderne.segmentCount).toBe(8);
    expect(moderne.sessionId).toBe('session-42');
    expect(moderne.map.mapName).toBe('Hangar');
    expect(moderne.video.sourceDurationS).toBe(10800);
  });
});
