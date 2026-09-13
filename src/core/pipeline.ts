import type {
  AppSettings,
  FrameFeature,
  GameProfileId,
  KnownMap,
  MatchAnalysis,
  MatchEvent,
  VideoMeta,
} from './types';
import { computeIntensity, runLocalAnalysis, selectKeyframeTimes } from './analysis/heuristics';
import { computeMetrics } from './analysis/metrics';
import {
  detectMatchSegments,
  sliceFeatures,
  wholeVideoSegment,
  type Segment,
} from './analysis/segmentation';
import { identifyMap, unknownMap } from './analysis/mapmatch';
import { detectBlackRuns, windowsBetweenBlackRuns } from './analysis/hud';
import { buildMapFingerprint, captureMapName } from './video/fingerprint';
import {
  extractKeyframes,
  loadVideo,
  sampleVideoFeatures,
  type Keyframe,
  type SampleProgress,
} from './video/sampler';

/**
 * Orchestration d'une analyse complete.
 *
 * Le fichier est parcouru une seule fois, quelle que soit sa longueur. On en
 * tire d'abord le signal brut, puis on decoupe la rediffusion en matchs, et
 * chaque match est ensuite analyse comme s'il s'agissait d'un fichier
 * autonome — horodatages remis a zero compris.
 */

export type PipelineStage =
  | 'chargement'
  | 'echantillonnage'
  | 'decoupage'
  | 'analyse'
  | 'carte'
  | 'images-cles'
  | 'termine';

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
  /** Arenes deja connues de l'appareil, pour reconnaitre la carte de chaque match. */
  mapLibrary?: readonly KnownMap[];
  title?: string;
  onProgress?: (p: PipelineProgress) => void;
  signal?: AbortSignal;
}

export interface PipelineResult {
  sessionId: string;
  analyses: MatchAnalysis[];
  /** Images cles par identifiant d'analyse, conservees le temps de la session. */
  keyframes: Map<string, Keyframe[]>;
  segments: Segment[];
  sourceDurationS: number;
  /** A revoquer quand on quitte la session. */
  objectUrl: string;
  videoElement: HTMLVideoElement;
}

function newId(prefix: string): string {
  const crypto = globalThis.crypto;
  if (crypto && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Titre par defaut lisible : nom du fichier sans extension. */
export function defaultTitle(meta: VideoMeta): string {
  const base = meta.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return base || 'Match sans titre';
}

export async function analyzeVideoFile(opts: PipelineOptions): Promise<PipelineResult> {
  const { file, profile, settings, onProgress, signal } = opts;
  const library = opts.mapLibrary ?? [];

  onProgress?.({ stage: 'chargement', ratio: 0, message: 'Lecture du fichier video...' });
  const loaded = await loadVideo(file);
  const sourceDurationS = loaded.meta.durationS;

  const sampleOptions: Parameters<typeof sampleVideoFeatures>[1] = {
    samplingHz: settings.samplingHz,
    onProgress: (p: SampleProgress) =>
      onProgress?.({
        stage: 'echantillonnage',
        ratio: p.total > 0 ? p.done / p.total : 0,
        message: `Image ${p.done}/${p.total}`,
      }),
  };
  if (signal) sampleOptions.signal = signal;

  const features: FrameFeature[] = await sampleVideoFeatures(loaded.element, sampleOptions);

  onProgress?.({ stage: 'decoupage', ratio: 0.5, message: 'Recherche des matchs...' });
  const intensity = computeIntensity(features, settings.samplingHz);
  const segments = resolveSegments(features, intensity, settings, sourceDurationS);

  const sessionId = newId('session');
  const baseTitle = opts.title?.trim() || defaultTitle(loaded.meta);
  const now = new Date().toISOString();

  const analyses: MatchAnalysis[] = [];
  const keyframes = new Map<string, Keyframe[]>();

  for (const [position, segment] of segments.entries()) {
    const label = segments.length > 1 ? ` (match ${segment.index}/${segments.length})` : '';
    const segmentRatio = (step: number) => (position + step) / segments.length;

    onProgress?.({
      stage: 'analyse',
      ratio: segmentRatio(0.1),
      message: `Analyse du match ${segment.index}/${segments.length}`,
    });

    const segmentFeatures = sliceFeatures(features, segment);
    const durationS = segment.endS - segment.startS;
    const local = runLocalAnalysis(segmentFeatures, { samplingHz: settings.samplingHz });
    const metrics = computeMetrics({
      features: segmentFeatures,
      engagements: local.engagements,
      events: local.events,
      durationS,
      samplingHz: settings.samplingHz,
      profile,
    });

    onProgress?.({
      stage: 'carte',
      ratio: segmentRatio(0.4),
      message: `Identification de l arene${label}`,
    });

    const fingerprintOptions: Parameters<typeof buildMapFingerprint>[3] = {};
    if (signal) fingerprintOptions.signal = signal;
    const palette = await buildMapFingerprint(
      loaded.element,
      segment.startS,
      segment.endS,
      fingerprintOptions,
    );

    // Le nom de carte est ecrit dans le HUD pendant toute la manche : sa trace
    // est de loin le signal le plus sur pour reconnaitre une arene.
    const nameCapture = await captureMapName(
      loaded.element,
      segment.startS,
      segment.endS,
      settings.mapNameRegion,
      fingerprintOptions,
    );
    const fingerprint = nameCapture ? { ...palette, nameMask: nameCapture.mask } : palette;
    const identification = library.length > 0 ? identifyMap(fingerprint, library) : unknownMap();

    onProgress?.({
      stage: 'images-cles',
      ratio: segmentRatio(0.6),
      message: `Extraction des images cles${label}`,
    });

    const segmentIntensity = computeIntensity(segmentFeatures, settings.samplingHz);
    // Une part du budget est reservee aux ecrans de fin : c'est la seule
    // source chiffree fiable de la manche (carte, mode, issue, K/D/A). Les
    // sacrifier pour une image d'action de plus serait un mauvais echange.
    const endScreenTimes = endScreenSamples(segment);
    const playBudget = Math.max(4, settings.aiFrameBudget - endScreenTimes.length);
    const relativeTimes = selectKeyframeTimes(segmentFeatures, segmentIntensity, playBudget);

    const keyframeOptions: Parameters<typeof extractKeyframes>[2] = {};
    if (signal) keyframeOptions.signal = signal;
    const absoluteTimes = [
      ...relativeTimes.map((t) => t + segment.startS),
      ...endScreenTimes,
    ];
    const extracted = await extractKeyframes(loaded.element, absoluteTimes, keyframeOptions);
    // Les images sont prelevees dans le fichier source, mais l'analyse raisonne
    // en temps de match : on repasse donc en horodatage relatif.
    const segmentKeyframes = extracted.map((frame) => ({
      ...frame,
      t: frame.t - segment.startS,
    }));

    const analysis: MatchAnalysis = {
      id: newId('match'),
      title: segments.length > 1 ? `${baseTitle} — match ${segment.index}` : baseTitle,
      createdAt: now,
      updatedAt: now,
      profile,
      video: { ...loaded.meta, durationS, sourceDurationS },
      sourceOffsetS: segment.startS,
      segmentIndex: segment.index,
      segmentCount: segments.length,
      sessionId,
      map: {
        mapId: identification.mapId,
        mapName: identification.mapName,
        confidence: identification.confidence,
        confirmed: false,
        distance: identification.distance,
      },
      mapFingerprint: fingerprint,
      ...(nameCapture ? { mapNameCrop: nameCapture.crop } : {}),
      outcome: 'inconnue' as const,
      settings: {
        samplingHz: settings.samplingHz,
        aiEnabled: settings.aiEnabled,
        aiModel: settings.aiModel,
        aiFrameBudget: settings.aiFrameBudget,
      },
      features: segmentFeatures,
      events: local.events,
      metrics,
      notes: '',
    };

    analyses.push(analysis);
    keyframes.set(analysis.id, segmentKeyframes);
  }

  onProgress?.({
    stage: 'termine',
    ratio: 1,
    message:
      segments.length > 1
        ? `${segments.length} matchs analyses.`
        : 'Analyse locale terminee.',
  });

  return {
    sessionId,
    analyses,
    keyframes,
    segments,
    sourceDurationS,
    objectUrl: loaded.objectUrl,
    videoElement: loaded.element,
  };
}

/**
 * Choisit le decoupage a appliquer.
 *
 * Si le decoupage automatique ne trouve rien — une video courte, ou une
 * captation dont le signal ne se prete pas a la detection — on retombe sur le
 * fichier entier plutot que de ne rien rendre au joueur.
 */
function resolveSegments(
  features: readonly FrameFeature[],
  intensity: readonly number[],
  settings: AppSettings,
  durationS: number,
): Segment[] {
  if (!settings.autoSegment) return [wholeVideoSegment(durationS)];

  // EVA insere un ecran noir apres le decompte de debut et apres le tableau
  // des scores : quand ils sont la, ils valent mieux que n'importe quelle
  // estimation par le mouvement, puisqu'ils viennent du jeu.
  const windows = settings.useBlackScreens
    ? windowsBetweenBlackRuns(detectBlackRuns(features), durationS)
    : [];

  const options = {
    samplingHz: settings.samplingHz,
    minMatchS: settings.minMatchS,
    minGapS: settings.minGapS,
  };

  if (windows.length > 1) {
    const { segments } = detectMatchSegments(features, intensity, { ...options, windows });
    if (segments.length > 0) return segments;
  }

  // Pas d'ecran noir exploitable — captation recadree, montage, fondu doux :
  // on retombe sur le decoupage par le mouvement.
  const { segments } = detectMatchSegments(features, intensity, options);
  return segments.length > 0 ? segments : [wholeVideoSegment(durationS)];
}

/**
 * Instants a prelever apres la fin du jeu : ecran de victoire, puis tableau
 * des scores. Ils sont statiques, donc exclus du match, mais c'est la que le
 * jeu ecrit la carte, le mode, l'issue et les K/D/A.
 */
function endScreenSamples(segment: Segment): number[] {
  const span = segment.windowEndS - segment.endS;
  if (span < 2) return [];
  const count = span >= 12 ? 4 : span >= 6 ? 3 : 2;
  // On evite le tout dernier instant, souvent deja en fondu vers le noir.
  return Array.from({ length: count }, (_, i) => segment.endS + (span * (i + 1)) / (count + 1));
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
    officialStats: analysis.officialStats,
  });

  return {
    ...analysis,
    events: [...events].sort((a, b) => a.t - b.t),
    metrics,
    updatedAt: new Date().toISOString(),
  };
}
