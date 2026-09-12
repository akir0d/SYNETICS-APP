import { z } from 'zod';

/**
 * Schema de sortie impose a Claude. Passer par un schema plutot que par du
 * texte libre garantit que la timeline reste exploitable par l'application
 * (et non une jolie prose impossible a recroiser avec la video).
 */

export const AI_EVENT_TYPES = [
  'kill',
  'death',
  'damage_taken',
  'objective',
  'respawn',
  'note',
] as const;

export const AiTimelineNoteSchema = z.object({
  t: z.number().describe("Instant dans la video, en secondes, repris d'une image fournie"),
  type: z.enum(AI_EVENT_TYPES).describe("Nature de l'evenement observe"),
  confidence: z.number().min(0).max(1).describe('Certitude de 0 a 1'),
  label: z.string().describe('Titre court, 6 mots maximum'),
  comment: z.string().describe('Ce qui est visible a l image et ce que cela implique'),
});

export const AiDrillSchema = z.object({
  title: z.string().describe("Nom de l'exercice"),
  description: z.string().describe('Comment le realiser concretement en arene'),
  focus: z.string().describe('Competence travaillee : visee, placement, communication, rythme...'),
});

export const AiAnalysisSchema = z.object({
  summary: z.string().describe('Synthese du match en 3 a 5 phrases, adressee au joueur'),
  strengths: z.array(z.string()).describe('Points forts observes, 2 a 4 elements'),
  weaknesses: z.array(z.string()).describe('Axes de progres observes, 2 a 4 elements'),
  drills: z.array(AiDrillSchema).describe('2 a 3 exercices concrets pour la prochaine session'),
  timeline: z.array(AiTimelineNoteSchema).describe('Moments cles reperes sur les images'),
  caveats: z
    .string()
    .describe("Ce que les images ne permettent pas de juger. Sois explicite sur l'incertitude."),
});

export type AiAnalysis = z.infer<typeof AiAnalysisSchema>;
