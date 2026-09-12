import type { Engagement, FrameFeature, MatchEvent } from '../types';
import { clamp01, mad, median, movingAverage, normalizeRobust, percentile } from './stats';

/**
 * Moteur d'analyse local : il ne connait rien a EVA, il lit uniquement le
 * signal visuel de la video (mouvement, flashs, coupures). Les evenements
 * produits sont donc des *signaux* candidats, pas des faits de jeu certains :
 * l'IA et le marquage manuel servent a les qualifier.
 */

export interface HeuristicOptions {
  /** Frequence d'echantillonnage des images, en Hz. */
  samplingHz: number;
  /** Duree minimale d'un engagement, en secondes. */
  minEngagementS: number;
  /** Deux engagements separes de moins que cela sont fusionnes. */
  mergeGapS: number;
  /** Seuil (score z robuste) au-dela duquel un flash rouge compte comme exposition. */
  exposureZ: number;
  /** Delai minimal entre deux detections du meme type, en secondes. */
  refractoryS: number;
}

export const DEFAULT_HEURISTICS: HeuristicOptions = {
  samplingHz: 2,
  minEngagementS: 1.5,
  mergeGapS: 2,
  exposureZ: 3,
  refractoryS: 1.5,
};

export interface HeuristicResult {
  /** Intensite normalisee 0..1, alignee sur `features`. */
  intensity: number[];
  engagements: Engagement[];
  events: MatchEvent[];
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

/** Reinitialise le compteur d'identifiants (utile pour des tests deterministes). */
export function resetEventIdCounter(): void {
  seq = 0;
}

/**
 * Amplitude de mouvement minimale, en difference moyenne de luminance entre
 * deux images echantillonnees, pour considerer qu'une video contient
 * reellement de l'action.
 */
const MIN_MOTION_SPAN = 0.04;

/**
 * Calcule l'intensite d'action : le mouvement domine, la saturation
 * (flashs de tir, HUD, explosions) apporte un appoint.
 *
 * La normalisation est relative a la video, pour encaisser aussi bien une
 * capture propre qu'un filmage de telephone. Mais une normalisation purement
 * relative etire aussi le bruit d'une video ou il ne se passe rien jusqu'a lui
 * donner l'allure d'un combat : on la pondere donc par l'amplitude reelle du
 * mouvement, ce qui maintient une video statique proche de zero.
 */
export function computeIntensity(features: readonly FrameFeature[], samplingHz: number): number[] {
  if (features.length === 0) return [];

  const diffs = features.map((f) => f.diff);
  const span = percentile(diffs, 95) - percentile(diffs, 5);
  const gate = clamp01(span / MIN_MOTION_SPAN);

  const motion = normalizeRobust(diffs);
  const flash = normalizeRobust(features.map((f) => f.saturation));
  const blended = motion.map((m, i) => clamp01((0.75 * m + 0.25 * (flash[i] as number)) * gate));

  // Lissage sur ~1,5 s : on cherche des phases de jeu, pas des images isolees.
  const window = Math.max(1, Math.round(1.5 * samplingHz));
  return movingAverage(blended, window);
}

/**
 * Decoupe la partie en phases d'action via un seuil a hysteresis :
 * on entre en engagement plus haut qu'on n'en sort, ce qui evite le
 * clignotement d'etat autour d'un seuil unique.
 */
export function detectEngagements(
  features: readonly FrameFeature[],
  intensity: readonly number[],
  opts: HeuristicOptions,
): Engagement[] {
  if (features.length === 0) return [];

  const enter = Math.max(0.35, percentile(intensity, 70));
  const exit = enter * 0.6;

  const raw: Engagement[] = [];
  let startIdx: number | null = null;

  for (let i = 0; i < intensity.length; i++) {
    const v = intensity[i] as number;
    if (startIdx === null && v >= enter) {
      startIdx = i;
    } else if (startIdx !== null && v < exit) {
      raw.push(buildEngagement(features, intensity, startIdx, i - 1));
      startIdx = null;
    }
  }
  if (startIdx !== null) {
    raw.push(buildEngagement(features, intensity, startIdx, intensity.length - 1));
  }

  // Fusion des phases proches, puis rejet des phases trop courtes.
  const merged: Engagement[] = [];
  for (const eng of raw) {
    const last = merged[merged.length - 1];
    if (last && eng.startS - last.endS <= opts.mergeGapS) {
      last.endS = eng.endS;
      last.intensity = (last.intensity + eng.intensity) / 2;
      last.peak = Math.max(last.peak, eng.peak);
    } else {
      merged.push({ ...eng });
    }
  }
  return merged.filter((e) => e.endS - e.startS >= opts.minEngagementS);
}

function buildEngagement(
  features: readonly FrameFeature[],
  intensity: readonly number[],
  from: number,
  to: number,
): Engagement {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(features.length - 1, Math.max(from, to));
  let sum = 0;
  let peak = 0;
  for (let i = lo; i <= hi; i++) {
    const v = intensity[i] as number;
    sum += v;
    if (v > peak) peak = v;
  }
  return {
    startS: (features[lo] as FrameFeature).t,
    endS: (features[hi] as FrameFeature).t,
    intensity: sum / (hi - lo + 1),
    peak,
  };
}

/** Dominance de rouge, au-dessus du fond, a partir de laquelle un voile est visible a l'oeil. */
const MIN_RED_JUMP = 0.05;

/** Ecart de mouvement, au-dessus du fond, qui trahit une coupure franche. */
const MIN_CUT_JUMP = 0.25;

/**
 * Calcule un seuil de detection en combinant deux lectures.
 *
 * Le seuil relatif (mediane + N ecarts absolus medians) s'adapte au bruit
 * propre a chaque video. Mais il devient aveugle sur une image tres stable :
 * l'ecart absolu median tombe alors a zero, et tout ecart, meme enorme,
 * se retrouve a un score z de zero. Le plancher absolu garantit donc qu'un
 * signal franc reste detectable meme sur un fond parfaitement propre.
 */
function detectionThreshold(values: readonly number[], sigmas: number, absoluteJump: number): number {
  const base = median(values);
  const spread = mad(values);
  const relative = spread > 1e-6 ? base + sigmas * spread : Number.NEGATIVE_INFINITY;
  return Math.max(base + absoluteJump, relative);
}

/**
 * Pics de dominance rouge : dans la quasi-totalite des FPS, subir des degats
 * declenche un voile rouge bref. On cherche donc des maxima locaux nettement
 * au-dessus du fond, avec une periode refractaire pour ne pas compter
 * dix fois le meme flash.
 */
export function detectExposure(
  features: readonly FrameFeature[],
  opts: HeuristicOptions,
): MatchEvent[] {
  if (features.length < 3) return [];

  const red = features.map((f) => f.redBias);
  const threshold = detectionThreshold(red, opts.exposureZ, MIN_RED_JUMP);

  const events: MatchEvent[] = [];
  let lastT = Number.NEGATIVE_INFINITY;

  for (let i = 1; i < features.length - 1; i++) {
    const f = features[i] as FrameFeature;
    const value = red[i] as number;
    const isLocalMax = value >= (red[i - 1] as number) && value >= (red[i + 1] as number);

    if (value >= threshold && isLocalMax && f.t - lastT >= opts.refractoryS) {
      lastT = f.t;
      events.push({
        id: nextId('exp'),
        t: f.t,
        type: 'damage_taken',
        source: 'local',
        // Plus le voile depasse le seuil, plus on y croit — sans jamais
        // pretendre a la certitude : seul le joueur ou l'IA peut trancher.
        confidence: clamp01(0.35 + 0.45 * ((value - threshold) / Math.max(MIN_RED_JUMP, threshold))),
        label: 'Flash rouge detecte',
        comment: 'Signal visuel compatible avec des degats subis. A confirmer.',
      });
    }
  }
  return events;
}

/**
 * Coupures franches : changement d'image massif combine a une chute ou une
 * montee de luminance. En jeu cela correspond souvent a une mort, une
 * reapparition ou un changement de camera.
 */
export function detectSceneCuts(
  features: readonly FrameFeature[],
  opts: HeuristicOptions,
): MatchEvent[] {
  if (features.length < 3) return [];

  const diffs = features.map((f) => f.diff);
  const threshold = detectionThreshold(diffs, 6, MIN_CUT_JUMP);

  const events: MatchEvent[] = [];
  let lastT = Number.NEGATIVE_INFINITY;

  for (let i = 1; i < features.length; i++) {
    const f = features[i] as FrameFeature;
    const prev = features[i - 1] as FrameFeature;
    const lumaJump = Math.abs(f.luma - prev.luma);
    if ((diffs[i] as number) >= threshold && lumaJump >= 0.12 && f.t - lastT >= opts.refractoryS) {
      lastT = f.t;
      events.push({
        id: nextId('cut'),
        t: f.t,
        type: 'scene_cut',
        source: 'local',
        confidence: 0.4,
        label: 'Transition brutale',
        comment: 'Coupure d image marquee : mort, reapparition ou changement de vue.',
      });
    }
  }
  return events;
}

/** Analyse locale complete, 100 % hors-ligne. */
export function runLocalAnalysis(
  features: readonly FrameFeature[],
  options: Partial<HeuristicOptions> = {},
): HeuristicResult {
  const opts: HeuristicOptions = { ...DEFAULT_HEURISTICS, ...options };
  const intensity = computeIntensity(features, opts.samplingHz);
  const engagements = detectEngagements(features, intensity, opts);

  const events: MatchEvent[] = [];
  for (const eng of engagements) {
    events.push({
      id: nextId('eng-start'),
      t: eng.startS,
      type: 'engagement_start',
      source: 'local',
      confidence: clamp01(0.4 + 0.5 * eng.peak),
      label: 'Debut de phase active',
    });
    events.push({
      id: nextId('eng-end'),
      t: eng.endS,
      type: 'engagement_end',
      source: 'local',
      confidence: clamp01(0.4 + 0.5 * eng.peak),
      label: 'Fin de phase active',
    });
  }
  events.push(...detectExposure(features, opts));
  events.push(...detectSceneCuts(features, opts));
  events.sort((a, b) => a.t - b.t);

  return { intensity, engagements, events };
}

/**
 * Selectionne les images les plus informatives pour l'IA : les pics d'action
 * d'abord, completes par une grille reguliere pour ne pas rater les phases
 * calmes (rotation, positionnement) qui expliquent souvent ce qui suit.
 */
export function selectKeyframeTimes(
  features: readonly FrameFeature[],
  intensity: readonly number[],
  budget: number,
): number[] {
  if (features.length === 0 || budget <= 0) return [];
  if (features.length <= budget) return features.map((f) => f.t);

  const peakBudget = Math.floor(budget * 0.6);
  const gridBudget = budget - peakBudget;

  const byIntensity = features
    .map((f, i) => ({ t: f.t, v: intensity[i] ?? 0 }))
    .sort((a, b) => b.v - a.v);

  const minSpacing = Math.max(
    2,
    (features[features.length - 1] as FrameFeature).t / (budget * 1.5),
  );
  const chosen: number[] = [];
  for (const cand of byIntensity) {
    if (chosen.length >= peakBudget) break;
    if (chosen.every((t) => Math.abs(t - cand.t) >= minSpacing)) chosen.push(cand.t);
  }

  const duration = (features[features.length - 1] as FrameFeature).t;
  for (let i = 0; i < gridBudget; i++) {
    const t = (duration * (i + 0.5)) / gridBudget;
    const nearest = features.reduce((best, f) =>
      Math.abs(f.t - t) < Math.abs(best.t - t) ? f : best,
    );
    if (chosen.every((c) => Math.abs(c - nearest.t) >= minSpacing / 2)) chosen.push(nearest.t);
  }

  return [...new Set(chosen)].sort((a, b) => a - b).slice(0, budget);
}
