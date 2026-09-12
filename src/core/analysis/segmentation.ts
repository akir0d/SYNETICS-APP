import type { FrameFeature } from '../types';
import { clamp01, movingAverage } from './stats';

/**
 * Decoupage d'une rediffusion en matchs.
 *
 * Une session EVA de trois heures contient une poignee de manches separees par
 * des temps morts : briefing, rhabillage, attente entre deux groupes. Le
 * moteur ne cherche pas a comprendre ce qui se passe a l'ecran ; il s'appuie
 * sur une constante physique du free roaming : en jeu, le joueur bouge la tete
 * en permanence, donc l'image bouge en permanence. Entre deux manches, l'image
 * est comparativement figee.
 */

export interface Segment {
  /** Rang du match dans la rediffusion, a partir de 1. */
  index: number;
  startS: number;
  endS: number;
  /** Part du temps reellement actif a l'interieur du segment, 0 a 1. */
  activityRatio: number;
  /** 0 a 1 : nettete du decoupage (densite d'action et franchise des pauses). */
  confidence: number;
}

export interface SegmentationOptions {
  samplingHz: number;
  /** Duree minimale d'un match retenu. Plus court est considere comme du bruit. */
  minMatchS: number;
  /** Duree minimale d'un temps mort pour separer deux matchs. */
  minGapS: number;
  /** Au-dela de cette duree, un segment est reexamine et scinde si possible. */
  maxMatchS: number;
  /** Fenetre de lissage de la densite d'action, en secondes. */
  densityWindowS: number;
  /** Intensite au-dela de laquelle une image compte comme "en jeu". */
  idleIntensity: number;
  /**
   * Mouvement brut minimal, en difference moyenne de luminance entre deux
   * images, pour qu'une image compte comme "en jeu".
   *
   * L'intensite est normalisee par rapport a la video : sur une captation ou
   * il ne se passe rien, elle etire le bruit de compression jusqu'a lui donner
   * l'allure d'une action. Ce plancher, lui, est absolu : un ecran d'attente
   * reste sous la barre quoi qu'il arrive.
   */
  minMotion: number;
  /** Densite d'entree en match (hysteresis haute). */
  enterDensity: number;
  /** Densite de sortie de match (hysteresis basse). */
  exitDensity: number;
}

export const DEFAULT_SEGMENTATION: SegmentationOptions = {
  samplingHz: 3,
  minMatchS: 90,
  minGapS: 40,
  maxMatchS: 1800,
  densityWindowS: 20,
  idleIntensity: 0.12,
  minMotion: 0.02,
  enterDensity: 0.35,
  exitDensity: 0.2,
};

export interface SegmentationResult {
  segments: Segment[];
  /** Densite d'action lissee, alignee sur `features`. Sert a l'affichage. */
  density: number[];
  /** Temps morts retenus entre deux matchs. */
  gaps: Array<{ startS: number; endS: number }>;
}

interface Span {
  from: number;
  to: number;
}

/**
 * Decoupe une rediffusion en matchs a partir du signal d'intensite deja
 * calcule par le moteur d'analyse.
 */
export function detectMatchSegments(
  features: readonly FrameFeature[],
  intensity: readonly number[],
  options: Partial<SegmentationOptions> = {},
): SegmentationResult {
  const opts: SegmentationOptions = { ...DEFAULT_SEGMENTATION, ...options };

  if (features.length === 0) return { segments: [], density: [], gaps: [] };

  const active = intensity.map((v, i) =>
    v >= opts.idleIntensity && (features[i] as FrameFeature).diff >= opts.minMotion ? 1 : 0,
  );
  // La fenetre de lissage doit rester plus etroite que la plus courte pause
  // qu'on veut detecter, sinon elle la comble et deux manches consecutives se
  // retrouvent fusionnees. On la borne donc par le reglage de pause minimale.
  const windowS = Math.min(opts.densityWindowS, Math.max(2, opts.minGapS * 0.6));
  const window = Math.max(1, Math.round(windowS * opts.samplingHz));
  const density = movingAverage(active, window);

  let spans = spansByHysteresis(density, opts.enterDensity, opts.exitDensity);
  spans = mergeCloseSpans(spans, features, opts.minGapS);
  spans = spans.map((span) => trimToActivity(span, active));
  spans = spans.filter((span) => durationOf(span, features) >= opts.minMatchS);
  spans = spans.flatMap((span) => splitOverlongSpan(span, density, features, opts));
  spans = spans.filter((span) => durationOf(span, features) >= opts.minMatchS);

  const segments: Segment[] = spans.map((span, i) => {
    const activityRatio = meanOf(active, span);
    return {
      index: i + 1,
      startS: timeAt(features, span.from),
      endS: timeAt(features, span.to),
      activityRatio,
      // Un match franc est dense en action ; un decoupage douteux l'est moins.
      confidence: clamp01(0.25 + 0.75 * meanOf(density, span)) * clamp01(activityRatio / 0.5),
    };
  });

  return { segments, density, gaps: gapsBetween(segments, timeAt(features, features.length - 1)) };
}

/**
 * Un seuil unique ferait clignoter l'etat autour de sa valeur : on entre donc
 * en match plus haut qu'on n'en sort.
 */
function spansByHysteresis(density: readonly number[], enter: number, exit: number): Span[] {
  const spans: Span[] = [];
  let from: number | null = null;

  for (let i = 0; i < density.length; i++) {
    const v = density[i] as number;
    if (from === null && v >= enter) from = i;
    else if (from !== null && v < exit) {
      spans.push({ from, to: i - 1 });
      from = null;
    }
  }
  if (from !== null) spans.push({ from, to: density.length - 1 });
  return spans;
}

/**
 * Une rotation calme ou une attente de reapparition ne coupe pas un match :
 * seules les pauses assez longues separent deux manches.
 */
function mergeCloseSpans(spans: Span[], features: readonly FrameFeature[], minGapS: number): Span[] {
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && timeAt(features, span.from) - timeAt(features, last.to) < minGapS) {
      last.to = span.to;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/** Ramene les bornes du segment sur la premiere et la derniere image active. */
function trimToActivity(span: Span, active: readonly number[]): Span {
  let from = span.from;
  let to = span.to;
  while (from < to && active[from] === 0) from++;
  while (to > from && active[to] === 0) to--;
  return { from, to };
}

/**
 * Filet de securite : deux manches enchainees sans vraie pause resteraient
 * collees. On scinde alors au creux d'activite le plus marque, en restant
 * loin des bords pour ne pas detacher un simple debut de manche calme.
 */
function splitOverlongSpan(
  span: Span,
  density: readonly number[],
  features: readonly FrameFeature[],
  opts: SegmentationOptions,
): Span[] {
  if (durationOf(span, features) <= opts.maxMatchS) return [span];

  const margin = Math.round((span.to - span.from) * 0.2);
  const from = span.from + margin;
  const to = span.to - margin;
  if (to <= from) return [span];

  let valley = from;
  for (let i = from; i <= to; i++) {
    if ((density[i] as number) < (density[valley] as number)) valley = i;
  }

  const left = trimToActivity({ from: span.from, to: valley }, density.map((d) => (d > 0 ? 1 : 0)));
  const right = { from: valley + 1, to: span.to };
  if (durationOf(left, features) < opts.minMatchS || durationOf(right, features) < opts.minMatchS) {
    return [span];
  }

  return [
    ...splitOverlongSpan(left, density, features, opts),
    ...splitOverlongSpan(right, density, features, opts),
  ];
}

function gapsBetween(segments: readonly Segment[], durationS: number) {
  const gaps: Array<{ startS: number; endS: number }> = [];
  if (segments.length === 0) return gaps;

  const first = segments[0] as Segment;
  if (first.startS > 0) gaps.push({ startS: 0, endS: first.startS });
  for (let i = 1; i < segments.length; i++) {
    gaps.push({
      startS: (segments[i - 1] as Segment).endS,
      endS: (segments[i] as Segment).startS,
    });
  }
  const last = segments[segments.length - 1] as Segment;
  if (durationS > last.endS) gaps.push({ startS: last.endS, endS: durationS });
  return gaps;
}

function timeAt(features: readonly FrameFeature[], index: number): number {
  const clamped = Math.min(features.length - 1, Math.max(0, index));
  return (features[clamped] as FrameFeature).t;
}

function durationOf(span: Span, features: readonly FrameFeature[]): number {
  return timeAt(features, span.to) - timeAt(features, span.from);
}

function meanOf(values: readonly number[], span: Span): number {
  let sum = 0;
  let count = 0;
  for (let i = span.from; i <= span.to && i < values.length; i++) {
    sum += values[i] as number;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Extrait les mesures d'un segment et remet ses horodatages a zero, pour que
 * chaque match s'analyse ensuite exactement comme un fichier autonome.
 */
export function sliceFeatures(
  features: readonly FrameFeature[],
  segment: Segment,
): FrameFeature[] {
  return features
    .filter((f) => f.t >= segment.startS && f.t <= segment.endS)
    .map((f) => ({ ...f, t: f.t - segment.startS }));
}

/** Segment unique couvrant tout le fichier, quand le decoupage est desactive. */
export function wholeVideoSegment(durationS: number): Segment {
  return { index: 1, startS: 0, endS: durationS, activityRatio: 1, confidence: 1 };
}
