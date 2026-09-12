import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { AiReport, MatchEvent } from '../types';
import type { Keyframe } from '../video/sampler';
import { AiAnalysisSchema, type AiAnalysis } from './schema';
import { COACH_SYSTEM_PROMPT, buildAnalysisInstruction, type AnalysisContext } from './prompts';

export interface ClaudeAnalysisRequest {
  apiKey: string;
  model: string;
  frames: readonly Keyframe[];
  context: AnalysisContext;
  signal?: AbortSignal;
}

export class MissingApiKeyError extends Error {
  constructor() {
    super("Aucune cle API Anthropic n'est configuree. Renseignez-la dans les Reglages.");
    this.name = 'MissingApiKeyError';
  }
}

/**
 * `effort` n'est pas accepte par Haiku 4.5 : on ne l'envoie que sur les
 * modeles qui le supportent, plutot que de risquer un 400 selon le reglage.
 */
function supportsEffort(model: string): boolean {
  return !model.startsWith('claude-haiku');
}

function createClient(apiKey: string): Anthropic {
  // L'application n'a pas de serveur : l'appel part du poste du joueur avec
  // sa propre cle. C'est le compromis assume d'une app 100 % locale.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

/** Envoie les images cles a Claude et recupere une analyse structuree. */
export async function analyzeMatchWithClaude(req: ClaudeAnalysisRequest): Promise<AiReport> {
  if (!req.apiKey.trim()) throw new MissingApiKeyError();
  if (req.frames.length === 0) throw new Error('Aucune image a analyser.');

  const client = createClient(req.apiKey.trim());

  // Chaque image est precedee de son horodatage : sans ce reperage, le modele
  // ne peut pas rattacher ses observations a la timeline de la video.
  const content: Anthropic.ContentBlockParam[] = [];
  for (const frame of req.frames) {
    content.push({ type: 'text', text: `Image a t = ${frame.t.toFixed(1)} s` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: frame.mediaType, data: frame.base64 },
    });
  }
  content.push({ type: 'text', text: buildAnalysisInstruction(req.context) });

  const response = await client.messages.parse(
    {
      model: req.model,
      max_tokens: 16000,
      system: [{ type: 'text', text: COACH_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
      output_config: {
        format: zodOutputFormat(AiAnalysisSchema),
        ...(supportsEffort(req.model) ? { effort: 'high' as const } : {}),
      },
    },
    req.signal ? { signal: req.signal } : undefined,
  );

  if (response.stop_reason === 'refusal') {
    throw new Error(
      "Le modele a refuse d'analyser ces images. Verifiez le contenu de la video et reessayez.",
    );
  }

  const parsed = response.parsed_output as AiAnalysis | null;
  if (!parsed) {
    throw new Error("Reponse de l'IA illisible : reessayez, eventuellement avec moins d'images.");
  }

  return {
    model: req.model,
    generatedAt: new Date().toISOString(),
    framesUsed: req.frames.length,
    summary: parsed.summary,
    strengths: parsed.strengths,
    weaknesses: parsed.weaknesses,
    drills: parsed.drills,
    timeline: parsed.timeline,
    caveats: parsed.caveats,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

/** Convertit la timeline de l'IA en evenements exploitables par l'application. */
export function aiReportToEvents(report: AiReport): MatchEvent[] {
  return report.timeline.map((note, i) => ({
    id: `ai-${report.generatedAt}-${i}`,
    t: note.t,
    type: note.type,
    source: 'ai' as const,
    confidence: note.confidence,
    label: note.label,
    comment: note.comment,
  }));
}

/** Message d'erreur lisible pour le joueur a partir d'une erreur SDK. */
export function describeAiError(error: unknown): string {
  if (error instanceof MissingApiKeyError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) {
    return 'Cle API refusee. Verifiez la cle dans les Reglages.';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Limite de debit atteinte. Attendez une minute puis relancez.';
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Impossible de joindre l'API Anthropic. Verifiez la connexion reseau.";
  }
  if (error instanceof Anthropic.NotFoundError) {
    return "Modele inconnu pour ce compte. Choisissez-en un autre dans les Reglages.";
  }
  if (error instanceof Anthropic.APIUserAbortError) return 'Analyse IA annulee.';
  if (error instanceof Anthropic.APIError) {
    return `Erreur API (${error.status ?? '?'}) : ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return 'Erreur inconnue pendant l analyse IA.';
}
