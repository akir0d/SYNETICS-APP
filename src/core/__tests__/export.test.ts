import { describe, expect, it } from 'vitest';
import { eventsToCsv, slugify, toJson, toMarkdown } from '../export';
import type { MatchAnalysis } from '../types';

const ANALYSIS: MatchAnalysis = {
  id: 'a1',
  title: 'Domination — Lyon Part-Dieu',
  createdAt: '2026-09-01T18:30:00.000Z',
  updatedAt: '2026-09-01T18:40:00.000Z',
  profile: 'domination',
  video: {
    name: 'match-01.mp4',
    sizeBytes: 1024,
    durationS: 125,
    sourceDurationS: 3600,
    width: 1920,
    height: 1080,
    mimeType: 'video/mp4',
  },
  sourceOffsetS: 620,
  outcome: 'victoire',
  segmentIndex: 3,
  segmentCount: 8,
  sessionId: 'session-1',
  map: {
    mapId: 'map-1',
    mapName: 'Hangar',
    confidence: 1,
    confirmed: true,
    distance: 0.08,
  },
  settings: { samplingHz: 2, aiEnabled: true, aiModel: 'claude-opus-5', aiFrameBudget: 24 },
  features: [],
  events: [
    {
      id: 'e2',
      t: 61,
      type: 'kill',
      source: 'manual',
      confidence: 1,
      label: 'Elimination',
      comment: 'Duel gagne; angle tenu, "propre"',
    },
    { id: 'e1', t: 12.5, type: 'damage_taken', source: 'local', confidence: 0.42 },
  ],
  metrics: {
    durationS: 125,
    sampledFrames: 250,
    samplingHz: 2,
    engagements: [],
    engagementCount: 3,
    activeRatio: 0.33,
    meanEngagementS: 9,
    longestCalmS: 40,
    tempoPerMin: 1.44,
    exposureEvents: 1,
    kills: 1,
    deaths: 0,
    objectives: 0,
    kd: 1,
    scores: { aggression: 60, consistency: 55, discipline: 72, tempo: 36 },
  },
  notes: 'Session du soir',
};

describe('export CSV', () => {
  const csv = eventsToCsv(ANALYSIS);
  const lignes = csv.split('\n');

  it('trie les evenements par ordre chronologique', () => {
    expect(lignes[1]).toContain('12.50');
    expect(lignes[2]).toContain('61.00');
  });

  it('echappe les separateurs et les guillemets contenus dans les commentaires', () => {
    const ligneKill = lignes[2] as string;
    expect(ligneKill).toContain('"Duel gagne; angle tenu, ""propre"""');
    // Le point-virgule du commentaire ne doit pas creer de colonne en trop.
    expect(ligneKill.split(';').length).toBe(8);
  });

  it('ecrit un en-tete lisible', () => {
    expect(lignes[0]).toBe('temps_s;temps_mmss;type;libelle;source;confiance;commentaire');
  });
});

describe('export Markdown', () => {
  const md = toMarkdown(ANALYSIS);

  it('reprend le titre, les mesures et les notes', () => {
    expect(md).toContain('# Domination — Lyon Part-Dieu');
    expect(md).toContain('| Phases d\'action | 3 |');
    expect(md).toContain('Session du soir');
  });

  it('omet la section IA quand aucune analyse IA n existe', () => {
    expect(md).not.toContain('## Analyse IA');
  });

  it('inclut la section IA des qu un rapport est present', () => {
    const avecIa = toMarkdown({
      ...ANALYSIS,
      ai: {
        model: 'claude-opus-5',
        generatedAt: '2026-09-01T18:45:00.000Z',
        framesUsed: 24,
        summary: 'Bon controle du point B.',
        strengths: ['Rotations rapides'],
        weaknesses: ['Angles decouverts'],
        drills: [{ title: 'Pre-visee', description: 'Tenir la ligne', focus: 'visee' }],
        timeline: [],
        caveats: 'Images echantillonnees.',
      },
    });
    expect(avecIa).toContain('## Analyse IA (claude-opus-5)');
    expect(avecIa).toContain('Rotations rapides');
    expect(avecIa).toContain('Limites relevees');
  });
});

describe('export JSON', () => {
  it('produit un document relisible tel quel', () => {
    const reparse = JSON.parse(toJson(ANALYSIS)) as MatchAnalysis;
    expect(reparse.id).toBe('a1');
    expect(reparse.events).toHaveLength(2);
  });
});

describe('noms de fichiers', () => {
  it('retire accents, espaces et ponctuation', () => {
    expect(slugify('Domination — Lyon Part-Dieu')).toBe('domination-lyon-part-dieu');
    expect(slugify('Été 2026 !')).toBe('ete-2026');
  });

  it('garde un nom utilisable quand le titre est vide', () => {
    expect(slugify('   ')).toBe('analyse');
    expect(slugify('!!!')).toBe('analyse');
  });
});
