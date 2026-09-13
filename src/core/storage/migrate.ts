import type { AiReport, MapIdentification, MatchAnalysis, VideoMeta } from '../types';

/**
 * Mise a niveau des analyses deja enregistrees sur l'appareil.
 *
 * Le stockage local garde des analyses produites par des versions
 * anterieures, auxquelles il manque les champs ajoutes depuis : decoupage en
 * matchs, identification d'arene, description d'arene par l'IA. Sans cette
 * normalisation, l'interface lit `undefined` et l'application entiere refuse
 * de s'afficher — une bibliotheque existante suffirait a la rendre
 * inutilisable apres mise a jour.
 *
 * On complete donc a la lecture, sans jamais reecrire le fichier d'origine :
 * une analyse ancienne reste une analyse ancienne, simplement affichable.
 */

const UNKNOWN_MAP: MapIdentification = {
  mapId: null,
  mapName: '',
  confidence: 0,
  confirmed: false,
  distance: null,
};

function normalizeVideo(video: Partial<VideoMeta> | undefined): VideoMeta {
  const durationS = typeof video?.durationS === 'number' ? video.durationS : 0;
  return {
    name: video?.name ?? 'video inconnue',
    sizeBytes: video?.sizeBytes ?? 0,
    durationS,
    // Avant le decoupage, un fichier valait un match : sa duree est donc celle
    // de la rediffusion.
    sourceDurationS:
      typeof video?.sourceDurationS === 'number' ? video.sourceDurationS : durationS,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    mimeType: video?.mimeType ?? 'video/mp4',
  };
}

function normalizeAi(ai: Partial<AiReport> | undefined): AiReport | undefined {
  if (!ai) return undefined;
  return {
    model: ai.model ?? 'inconnu',
    generatedAt: ai.generatedAt ?? new Date(0).toISOString(),
    framesUsed: ai.framesUsed ?? 0,
    summary: ai.summary ?? '',
    strengths: ai.strengths ?? [],
    weaknesses: ai.weaknesses ?? [],
    drills: ai.drills ?? [],
    timeline: ai.timeline ?? [],
    caveats: ai.caveats ?? '',
    ...(ai.usage ? { usage: ai.usage } : {}),
  };
}

/** Complete une analyse lue du stockage pour qu'elle respecte le modele courant. */
export function normalizeAnalysis(raw: Partial<MatchAnalysis> & { id: string }): MatchAnalysis {
  const video = normalizeVideo(raw.video);
  const ai = normalizeAi(raw.ai);

  return {
    id: raw.id,
    title: raw.title ?? 'Match sans titre',
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? new Date(0).toISOString(),
    profile: raw.profile ?? 'custom',
    video,
    sourceOffsetS: typeof raw.sourceOffsetS === 'number' ? raw.sourceOffsetS : 0,
    segmentIndex: typeof raw.segmentIndex === 'number' ? raw.segmentIndex : 1,
    segmentCount: typeof raw.segmentCount === 'number' ? raw.segmentCount : 1,
    sessionId: raw.sessionId ?? `session-heritee-${raw.id}`,
    map: raw.map ?? { ...UNKNOWN_MAP },
    ...(raw.mapFingerprint ? { mapFingerprint: raw.mapFingerprint } : {}),
    ...(raw.mapNameCrop ? { mapNameCrop: raw.mapNameCrop } : {}),
    ...(raw.readMapName ? { readMapName: raw.readMapName } : {}),
    ...(raw.readGameMode ? { readGameMode: raw.readGameMode } : {}),
    outcome: raw.outcome ?? 'inconnue',
    ...(raw.officialStats ? { officialStats: raw.officialStats } : {}),
    settings: raw.settings ?? {
      samplingHz: 2,
      aiEnabled: false,
      aiModel: 'claude-opus-5',
      aiFrameBudget: 24,
    },
    features: raw.features ?? [],
    events: raw.events ?? [],
    metrics: raw.metrics ?? {
      durationS: video.durationS,
      sampledFrames: 0,
      samplingHz: 2,
      engagements: [],
      engagementCount: 0,
      activeRatio: 0,
      meanEngagementS: 0,
      longestCalmS: video.durationS,
      tempoPerMin: 0,
      exposureEvents: 0,
      kills: 0,
      deaths: 0,
      objectives: 0,
      kd: null,
      scores: { aggression: 0, consistency: 0, discipline: 0, tempo: 0 },
    },
    ...(ai ? { ai } : {}),
    notes: raw.notes ?? '',
  };
}
