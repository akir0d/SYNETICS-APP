import { describe, expect, it } from 'vitest';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { AiAnalysisSchema } from '../ai/schema';
import { buildAnalysisInstruction, COACH_SYSTEM_PROMPT } from '../ai/prompts';
import type { MatchMetrics } from '../types';

const METRICS: MatchMetrics = {
  durationS: 300,
  sampledFrames: 600,
  samplingHz: 2,
  engagements: [],
  engagementCount: 6,
  activeRatio: 0.42,
  meanEngagementS: 21,
  longestCalmS: 55,
  tempoPerMin: 1.2,
  exposureEvents: 9,
  kills: 3,
  deaths: 2,
  objectives: 1,
  kd: 1.5,
  scores: { aggression: 70, consistency: 50, discipline: 61, tempo: 30 },
};

describe('schema de sortie IA', () => {
  it('se convertit en JSON Schema exploitable par l API', () => {
    // C'est la conversion que fait le SDK avant l'appel : si elle casse,
    // l'analyse IA echoue au moment de l'appel reseau, pas ici.
    const format = zodOutputFormat(AiAnalysisSchema);
    expect(format.type).toBe('json_schema');
    expect(format.schema).toBeTruthy();

    const schema = format.schema as { properties?: Record<string, unknown> };
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      'caveats',
      'drills',
      'environment',
      'strengths',
      'summary',
      'timeline',
      'weaknesses',
    ]);
  });

  it('accepte une reponse bien formee', () => {
    const parsed = AiAnalysisSchema.safeParse({
      summary: 'Match solide.',
      strengths: ['Placement'],
      weaknesses: ['Rechargements a decouvert'],
      drills: [{ title: 'Recharge sous couverture', description: 'Reculer avant', focus: 'gestion' }],
      timeline: [
        { t: 42.5, type: 'death', confidence: 0.8, label: 'Mort au centre', comment: 'Angle ouvert' },
      ],
      environment: { description: 'Hangar sombre', landmarks: ['Passerelle'] },
      caveats: 'Images echantillonnees.',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejette un type d evenement hors de la liste autorisee', () => {
    const parsed = AiAnalysisSchema.safeParse({
      summary: 'x',
      strengths: [],
      weaknesses: [],
      drills: [],
      timeline: [{ t: 1, type: 'scene_cut', confidence: 0.5, label: 'a', comment: 'b' }],
      environment: { description: 'x', landmarks: [] },
      caveats: '',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejette une confiance hors bornes', () => {
    const parsed = AiAnalysisSchema.safeParse({
      summary: 'x',
      strengths: [],
      weaknesses: [],
      drills: [],
      timeline: [{ t: 1, type: 'kill', confidence: 1.4, label: 'a', comment: 'b' }],
      environment: { description: 'x', landmarks: [] },
      caveats: '',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('prompt d analyse', () => {
  it('reste fige, pour que le cache de prefixe serve d une analyse a l autre', () => {
    expect(COACH_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(COACH_SYSTEM_PROMPT).toContain('eva.gg');
  });

  it('transmet le mode de jeu, les mesures et les horodatages des images', () => {
    const instruction = buildAnalysisInstruction({
      profile: 'bomb',
      metrics: METRICS,
      playerName: 'Nova',
      frameTimes: [0, 12.5, 40],
      notes: 'Manche decisive',
    });

    expect(instruction).toContain('Desamorcage');
    expect(instruction).toContain('une mort est definitive');
    expect(instruction).toContain('Nova');
    expect(instruction).toContain('0.0, 12.5, 40.0');
    expect(instruction).toContain('Manche decisive');
    expect(instruction).toContain('3 eliminations, 2 morts');
  });

  it('ne pretend pas que le joueur a annote quand il ne l a pas fait', () => {
    const instruction = buildAnalysisInstruction({
      profile: 'tdm',
      metrics: { ...METRICS, kills: 0, deaths: 0, objectives: 0 },
      playerName: '',
      frameTimes: [0],
      notes: '',
    });
    expect(instruction).toContain("n'a marque aucun evenement");
  });
});
