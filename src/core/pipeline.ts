import type {
  AppSettings,
  FrameFeature,
  GameProfileId,
  MatchAnalysis,
  MatchEvent,
  VideoMeta,
} from './types';
import { runLocalAnalysis, selectKeyframeTimes } from './analysis/heuristics';
import { computeMetrics } from './analysis/metrics';
import {
  extractKeyframes,
  loadVideo,
  sampleVideoFeatures,
  type Keyframe,
  type SampleProgress,
} from './video/sampler';

/**
 * Orchestration d'une analyse complete. L'interface ne fait qu'appeler
 * `analyzeVideoFile` et afficher la progression ; toute la logique est ici.
 */

export type PipelineStage = 'chargement' | 'echantillonnage' | 'analyse' | 'images-cles' | 'termine';

export interface PipelineProgress {
  stage: PipelineStage;
  /** 0 a 1 sur l'etape en cours. */
  ratio: number;
  message: string;
}

export interface PipelineOptions {
  file: File;
  profile: GameProfileId;
  settings: AppSettings;
  title?: string;
  onProgress?: (p: PipelineProgress) => void;
  signal?: AbortSignal;
}

export interface PipelineResult {
  analysis: MatchAnalysis;
  /** Images retenues pour l'IA, conservees en memoire le temps de la session. */
  keyframes: Keyframe[];
  /** Conserve pour la relecture ; a revoquer quand on quitte l'analyse. */
  objectUrl: string;
  videoElement: HTMLVideoElement;
}

function newId(): string {
  const crypto = globalThis.crypto;
  if (crypto && 'randomUUID' in crypto) return crypto.randomUUID();
  return `match-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Titre par defaut lisible : nom du fichier sans extension. */
export function defaultTitle(meta: VideoMeta): string {
  const base = meta.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return base || 'Match sans titre';
}

export async function analyzeVideoFile(opts: PipelineOptions): Promise<PipelineResult> {
  const { file, profile, settings, onProgress, signal } = opts;

  onProgress?.({ stage: 'chargement', ratio: 0, message: 'Lecture du fichier video...' });
  const loaded = await loadVideo(file);

  const forward = (stage: PipelineStage, label: string) => (p: SampleProgress) =>
    onProgress?.({
      stage,
      ratio: p.total > 0 ? p.done / p.total : 0,
      message: `${label} ${p.done}/${p.total}`,
    });

  const sampleOptions: Parameters<typeof sampleVideoFeatures>[1] = {
    samplingHz: settings.samplingHz,
    onProgress: forward('echantillonnage', 'Image'),
  };
  if (signal) sampleOptions.signal = signal;

  const features: FrameFeature[] = await sampleVideoFeatures(loaded.element, sampleOptions);

  onProgress?.({ stage: 'analyse', ratio: 0.5, message: 'Detection des phases de jeu...' });
  const local = runLocalAnalysis(features, { samplingHz: settings.samplingHz });
  const metrics = computeMetrics({
    features,
    engagements: local.engagements,
    events: local.events,
    durationS: loaded.meta.durationS,
    samplingHz: settings.samplingHz,
    profile,
  });

  onProgress?.({ stage: 'images-cles', ratio: 0, message: 'Extraction des images cles...' });
  const times = selectKeyframeTimes(features, local.intensity, settings.aiFrameBudget);
  const keyframeOptions: Parameters<typeof extractKeyframes>[2] = {
    onProgress: forward('images-cles', 'Image cle'),
  };
  if (signal) keyframeOptions.signal = signal;
  const keyframes = await extractKeyframes(loaded.element, times, keyframeOptions);

  const now = new Date().toISOString();
  const analysis: MatchAnalysis = {
    id: newId(),
    title: opts.title?.trim() || defaultTitle(loaded.meta),
    createdAt: now,
    updatedAt: now,
    profile,
    video: loaded.meta,
    settings: {
      samplingHz: settings.samplingHz,
      aiEnabled: settings.aiEnabled,
      aiModel: settings.aiModel,
      aiFrameBudget: settings.aiFrameBudget,
    },
    features,
    events: local.events,
    metrics,
    notes: '',
  };

  onProgress?.({ stage: 'termine', ratio: 1, message: 'Analyse locale terminee.' });

  return {
    analysis,
    keyframes,
    objectUrl: loaded.objectUrl,
    videoElement: loaded.element,
  };
}

/**
 * Recalcule les mesures apres une modification de la timeline (ajout manuel,
 * import IA). L'analyse reste ainsi toujours coherente avec ses evenements.
 */
export function recomputeAnalysis(analysis: MatchAnalysis, events: MatchEvent[]): MatchAnalysis {
  // Les phases de jeu proviennent du signal video : elles ne bougent pas quand
  // le joueur annote, mais les compteurs qui en dependent, si.
  const local = runLocalAnalysis(analysis.features, {
    samplingHz: analysis.settings.samplingHz,
  });

  const metrics = computeMetrics({
    features: analysis.features,
    engagements: local.engagements,
    events,
    durationS: analysis.video.durationS,
    samplingHz: analysis.settings.samplingHz,
    profile: analysis.profile,
  });

  return {
    ...analysis,
    events: [...events].sort((a, b) => a.t - b.t),
    metrics,
    updatedAt: new Date().toISOString(),
  };
}
