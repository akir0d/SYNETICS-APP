import type {
  AiScoreRow,
  Engagement,
  FrameFeature,
  GameProfileId,
  MatchEvent,
  MatchMetrics,
  MatchScores,
} from '../types';
import { GAME_PROFILES } from '../types';
import { clamp01, mean, stdDev } from './stats';

export interface MetricsInput {
  features: readonly FrameFeature[];
  engagements: readonly Engagement[];
  events: readonly MatchEvent[];
  durationS: number;
  samplingHz: number;
  profile: GameProfileId;
  /**
   * Ligne du joueur lue sur le tableau des scores du jeu. Elle prime sur le
   * marquage manuel : aucune annotation a posteriori ne vaut le chiffre que le
   * jeu a lui-meme affiche.
   */
  officialStats?: AiScoreRow | undefined;
}

/**
 * Reperes de normalisation des scores. Ce sont des conventions de lecture
 * assumees, pas des mesures issues de donnees EVA officielles : elles servent
 * a comparer vos propres matchs entre eux.
 */
const REF = {
  /** Part du temps en action consideree comme un match tres agressif. */
  activeRatioHigh: 0.55,
  /** Engagements par minute consideres comme un tempo tres eleve. */
  tempoHigh: 4,
  /** Expositions par minute d'action au-dela desquelles la discipline tombe a 0. */
  exposurePerActiveMinHigh: 8,
};

export function computeMetrics(input: MetricsInput): MatchMetrics {
  const { features, engagements, events, durationS, samplingHz, profile } = input;

  const activeSeconds = engagements.reduce((s, e) => s + Math.max(0, e.endS - e.startS), 0);
  const activeRatio = durationS > 0 ? clamp01(activeSeconds / durationS) : 0;
  const engagementCount = engagements.length;
  const meanEngagementS = engagementCount > 0 ? activeSeconds / engagementCount : 0;
  const tempoPerMin = durationS > 0 ? engagementCount / (durationS / 60) : 0;

  const official = input.officialStats;
  const kills = official ? official.kills : countType(events, 'kill');
  const deaths = official ? official.deaths : countType(events, 'death');
  const objectives = countType(events, 'objective');
  const exposureEvents = countType(events, 'damage_taken');

  return {
    durationS,
    sampledFrames: features.length,
    samplingHz,
    engagements: engagements.map((e) => ({ ...e })),
    engagementCount,
    activeRatio,
    meanEngagementS,
    longestCalmS: longestCalm(engagements, durationS),
    tempoPerMin,
    exposureEvents,
    kills,
    deaths,
    objectives,
    kd: deaths > 0 ? kills / deaths : kills > 0 ? kills : null,
    scores: computeScores({
      activeRatio,
      tempoPerMin,
      engagements,
      exposureEvents,
      activeSeconds,
      profile,
    }),
  };
}

function countType(events: readonly MatchEvent[], type: MatchEvent['type']): number {
  // Les evenements locaux sont des signaux, pas des faits : seuls le marquage
  // manuel et l'IA alimentent les compteurs de jeu (kills, morts, objectifs).
  // Seule exception : l'exposition, qui est par nature une mesure visuelle.
  const countsLocal = type === 'damage_taken';
  return events.filter((e) => e.type === type && (countsLocal || e.source !== 'local')).length;
}

/** Plus longue periode sans aucun engagement, bornes du match comprises. */
export function longestCalm(engagements: readonly Engagement[], durationS: number): number {
  if (durationS <= 0) return 0;
  if (engagements.length === 0) return durationS;
  const sorted = [...engagements].sort((a, b) => a.startS - b.startS);
  let longest = (sorted[0] as Engagement).startS;
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i] as Engagement).startS - (sorted[i - 1] as Engagement).endS;
    if (gap > longest) longest = gap;
  }
  const tail = durationS - (sorted[sorted.length - 1] as Engagement).endS;
  return Math.max(longest, tail, 0);
}

interface ScoreInput {
  activeRatio: number;
  tempoPerMin: number;
  engagements: readonly Engagement[];
  exposureEvents: number;
  activeSeconds: number;
  profile: GameProfileId;
}

export function computeScores(input: ScoreInput): MatchScores {
  const { activeRatio, tempoPerMin, engagements, exposureEvents, activeSeconds, profile } = input;

  const aggression = 100 * clamp01(activeRatio / REF.activeRatioHigh);
  const tempo = 100 * clamp01(tempoPerMin / REF.tempoHigh);

  // Regularite : coefficient de variation des intervalles entre engagements.
  const gaps: number[] = [];
  const sorted = [...engagements].sort((a, b) => a.startS - b.startS);
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((sorted[i] as Engagement).startS - (sorted[i - 1] as Engagement).startS);
  }
  const gapMean = mean(gaps);
  const cv = gaps.length >= 2 && gapMean > 0 ? stdDev(gaps) / gapMean : 0;
  const consistency = gaps.length >= 2 ? 100 * clamp01(1 - cv / 1.2) : 50;

  // Discipline : exposition rapportee au temps reellement passe en action.
  const activeMinutes = activeSeconds / 60;
  const exposureRate = activeMinutes > 0 ? exposureEvents / activeMinutes : 0;
  let discipline = 100 * clamp01(1 - exposureRate / REF.exposurePerActiveMinHigh);

  // Sans reapparition, chaque exposition pese plus lourd dans la lecture.
  if (!GAME_PROFILES[profile].respawn) discipline *= 0.85;

  return {
    aggression: round1(aggression),
    consistency: round1(consistency),
    discipline: round1(discipline),
    tempo: round1(tempo),
  };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
