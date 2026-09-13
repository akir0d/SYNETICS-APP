/**
 * Modele de donnees partage par toute l'application (web, Android, PC).
 * Tout ce qui est ici est pur TypeScript : aucune dependance DOM, donc testable.
 */

/** D'ou vient un evenement de la timeline. */
export type EventSource =
  /** Detecte hors-ligne par le moteur d'heuristiques video. */
  | 'local'
  /** Propose par l'analyse Claude (vision). */
  | 'ai'
  /** Saisi a la main par le joueur pendant la relecture. */
  | 'manual';

export type EventType =
  | 'kill'
  | 'death'
  | 'damage_taken'
  | 'objective'
  | 'respawn'
  | 'engagement_start'
  | 'engagement_end'
  | 'movement_peak'
  | 'scene_cut'
  | 'note';

export interface EventTypeMeta {
  label: string;
  short: string;
  color: string;
  /** Touche clavier pour le marquage rapide en relecture (PC). */
  hotkey?: string;
}

export const EVENT_TYPES: Record<EventType, EventTypeMeta> = {
  kill: { label: 'Elimination', short: 'KILL', color: '#4ade80', hotkey: 'k' },
  death: { label: 'Mort', short: 'MORT', color: '#f87171', hotkey: 'm' },
  damage_taken: { label: 'Degats subis', short: 'DGT', color: '#fb923c', hotkey: 'd' },
  objective: { label: 'Objectif', short: 'OBJ', color: '#60a5fa', hotkey: 'o' },
  respawn: { label: 'Reapparition', short: 'RESP', color: '#a78bfa', hotkey: 'r' },
  engagement_start: { label: 'Debut d engagement', short: 'ENG+', color: '#fbbf24' },
  engagement_end: { label: 'Fin d engagement', short: 'ENG-', color: '#fbbf24' },
  movement_peak: { label: 'Pic de mouvement', short: 'MOUV', color: '#22d3ee' },
  scene_cut: { label: 'Coupure / transition', short: 'CUT', color: '#94a3b8' },
  note: { label: 'Note libre', short: 'NOTE', color: '#e2e8f0', hotkey: 'n' },
};

export interface MatchEvent {
  id: string;
  /** Position dans la video, en secondes. */
  t: number;
  type: EventType;
  source: EventSource;
  /** 0 a 1. Les evenements manuels valent toujours 1. */
  confidence: number;
  label?: string;
  comment?: string;
}

/**
 * Mesures extraites d'une image echantillonnee. Volontairement minimal :
 * ces 4 nombres suffisent aux heuristiques et tiennent en memoire pour
 * une partie entiere (1 Hz sur 20 min = 1200 entrees).
 */
export interface FrameFeature {
  /** Timestamp de l'image, en secondes. */
  t: number;
  /** Luminance moyenne, 0 (noir) a 1 (blanc). */
  luma: number;
  /** Dominance du rouge par rapport aux autres canaux, 0 a 1. */
  redBias: number;
  /** Difference moyenne avec l'image precedente, 0 a 1. Proxy de mouvement. */
  diff: number;
  /** Part de pixels tres satures, 0 a 1. Proxy des flashs / effets HUD. */
  saturation: number;
}

/** Fenetre de jeu identifiee comme "action" par le moteur local. */
export interface Engagement {
  startS: number;
  endS: number;
  /** Intensite moyenne normalisee sur la fenetre, 0 a 1. */
  intensity: number;
  /** Pic d'intensite, 0 a 1. */
  peak: number;
}

export interface MatchScores {
  /** Part du temps passe en action soutenue. */
  aggression: number;
  /** Regularite du rythme entre engagements (faible variance = eleve). */
  consistency: number;
  /** Exposition subie rapportee au temps d'action (eleve = peu expose). */
  discipline: number;
  /** Densite d'engagements par minute, normalisee. */
  tempo: number;
}

export interface MatchMetrics {
  durationS: number;
  sampledFrames: number;
  samplingHz: number;
  engagements: Engagement[];
  engagementCount: number;
  /** Part du temps de match passee en engagement, 0 a 1. */
  activeRatio: number;
  meanEngagementS: number;
  longestCalmS: number;
  /** Engagements par minute. */
  tempoPerMin: number;
  /** Nombre de pics d'exposition (flashs de degats presumes). */
  exposureEvents: number;
  kills: number;
  deaths: number;
  objectives: number;
  /** null quand aucune mort n'est renseignee (evite un K/D trompeur). */
  kd: number | null;
  scores: MatchScores;
}

export interface AiDrill {
  title: string;
  description: string;
  focus: string;
}

export interface AiTimelineNote {
  t: number;
  type: EventType;
  confidence: number;
  label: string;
  comment: string;
}

/**
 * Ligne de joueur relevee sur le tableau des scores de fin de manche.
 *
 * Elle est lue hors ligne par la reconnaissance de glyphes de l'application,
 * jamais par un service distant.
 */
export interface AiScoreRow {
  player: string;
  team: string;
  score: number;
  kills: number;
  deaths: number;
  assists: number;
}

export interface AiReport {
  model: string;
  generatedAt: string;
  framesUsed: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  drills: AiDrill[];
  timeline: AiTimelineNote[];
  /** Mise en garde de l'IA sur ce qu'elle n'a pas pu juger. */
  caveats: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * Zone de l'image, en fractions de la largeur et de la hauteur (0 a 1).
 * Exprimee en relatif pour rester valable quelle que soit la definition.
 */
export interface HudRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Position par defaut du nom de carte dans le HUD d'EVA : centre en haut,
 * juste sous le chronometre. Reglable, car une captation recadree ou filmee
 * a l'ecran decale tout le HUD.
 */
export const DEFAULT_MAP_NAME_REGION: HudRegion = { x: 0.38, y: 0.09, width: 0.24, height: 0.07 };

/**
 * Cartes d'EVA connues a ce jour.
 *
 * Cette liste sert a deux choses : proposer au joueur des noms coherents d'un
 * match a l'autre — sans quoi la meme arene finirait enregistree sous trois
 * orthographes — et transformer la lecture du HUD par l'IA en un choix dans
 * une liste fermee plutot qu'en une invention libre.
 *
 * Elle ne verrouille rien : un nom hors liste reste accepte, pour le jour ou
 * EVA en ajoutera une.
 */
export const EVA_MAPS = [
  'Artefact',
  'Atlantis',
  'Ceres',
  'Engine',
  'Helios Station',
  'Horizon',
  'Lunar Outpost',
  'Outlaw',
  'Polaris',
  'Reef Point',
  'Silva',
  'The Cliff',
] as const;

export type EvaMapName = (typeof EVA_MAPS)[number];

/**
 * Ramene un nom saisi ou lu a l'orthographe du catalogue.
 * Renvoie le nom d'origine, simplement nettoye, s'il n'y figure pas.
 */
export function canonicalMapName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const normalise = (v: string) =>
    v
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();
  const cible = normalise(trimmed);
  return EVA_MAPS.find((m) => normalise(m) === cible) ?? trimmed;
}

/** Issue d'une manche, telle que l'annonce l'ecran de fin. */
export type MatchOutcome = 'victoire' | 'defaite' | 'inconnue';

export type GameProfileId = 'tdm' | 'domination' | 'bomb' | 'battle_royale' | 'custom';

export interface GameProfile {
  id: GameProfileId;
  name: string;
  description: string;
  /** Les joueurs reapparaissent-ils ? Change la lecture des morts. */
  respawn: boolean;
  objectiveLabel: string;
  /** Duree typique d'une manche, en minutes. Sert de garde-fou d'analyse. */
  typicalMinutes: number;
}

export const GAME_PROFILES: Record<GameProfileId, GameProfile> = {
  tdm: {
    id: 'tdm',
    name: 'Match a mort par equipe',
    description: 'Elimination continue avec reapparition. Le tempo et la survie priment.',
    respawn: true,
    objectiveLabel: 'Zone chaude',
    typicalMinutes: 10,
  },
  domination: {
    id: 'domination',
    name: 'Domination',
    description: 'Controle de points. Rotation et tenue de zone priment sur les frags.',
    respawn: true,
    objectiveLabel: 'Capture de point',
    typicalMinutes: 12,
  },
  bomb: {
    id: 'bomb',
    name: 'Desamorcage / Bombe',
    description: 'Manches courtes sans reapparition. Chaque mort coute la manche.',
    respawn: false,
    objectiveLabel: 'Pose / desamorcage',
    typicalMinutes: 3,
  },
  battle_royale: {
    id: 'battle_royale',
    name: 'Battle Royale',
    description: 'Une seule vie, zone qui se retrecit. Positionnement et timing priment.',
    respawn: false,
    objectiveLabel: 'Zone / loot',
    typicalMinutes: 8,
  },
  custom: {
    id: 'custom',
    name: 'Personnalise',
    description: 'Mode libre : aucune hypothese sur la reapparition ni les objectifs.',
    respawn: true,
    objectiveLabel: 'Objectif',
    typicalMinutes: 10,
  },
};

export interface VideoMeta {
  name: string;
  sizeBytes: number;
  /** Duree de ce match. Egale a `sourceDurationS` quand le fichier n'en contient qu'un. */
  durationS: number;
  /** Duree totale du fichier source, rediffusion complete comprise. */
  sourceDurationS: number;
  width: number;
  height: number;
  mimeType: string;
}

/**
 * Signature visuelle d'une arene.
 *
 * Elle ne reconnait aucune carte EVA d'origine : elle sert a rapprocher deux
 * matchs joues au meme endroit. C'est le joueur qui nomme une arene la
 * premiere fois ; l'application la reconnait ensuite toute seule.
 */
export interface MapFingerprint {
  /** Histogramme de teinte pondere par la saturation, 12 classes, somme = 1. */
  hue: number[];
  /** Histogramme de luminance, 8 classes, somme = 1. */
  luma: number[];
  /** Moyenne RVB par zone d'image, grille 4x3, valeurs 0..255. */
  zones: number[];
  /** Nombre d'images agregees dans cette signature. */
  frames: number;
  /**
   * Empreinte du nom de carte tel qu'il est ecrit dans le HUD : la zone est
   * binarisee puis reduite a une petite grille. Comme le jeu ecrit toujours le
   * meme texte, dans la meme police, au meme endroit, deux manches sur la meme
   * carte donnent une empreinte quasi identique — bien plus discriminante que
   * la seule palette de couleurs.
   */
  nameMask?: number[];
}

/** Arene enregistree dans la bibliotheque de cartes de l'appareil. */
export interface KnownMap {
  id: string;
  name: string;
  fingerprint: MapFingerprint;
  /** Nombre de matchs ayant servi a affiner cette signature. */
  matchCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Rattachement d'un match a une arene. */
export interface MapIdentification {
  /** Identifiant de l'arene reconnue, ou null tant qu'aucune ne correspond. */
  mapId: string | null;
  /** Nom affiche. Vide tant que le joueur n'a pas nomme l'arene. */
  mapName: string;
  /** 0 a 1. Vaut 1 quand le joueur a confirme lui-meme. */
  confidence: number;
  /** Le joueur a-t-il valide ce rattachement ? */
  confirmed: boolean;
  /** Distance a la signature de reference, pour expliquer un doute. */
  distance: number | null;
}

export interface AnalysisSettingsSnapshot {
  samplingHz: number;
  aiEnabled: boolean;
  aiModel: string;
  aiFrameBudget: number;
}

export interface MatchAnalysis {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  profile: GameProfileId;
  video: VideoMeta;
  /**
   * Debut de ce match dans le fichier source, en secondes.
   *
   * Les horodatages internes (mesures, evenements) repartent de zero a chaque
   * match : les mesures restent ainsi lisibles. Seule la lecture video ajoute
   * ce decalage pour retrouver le bon endroit dans la rediffusion.
   */
  sourceOffsetS: number;
  /** Rang du match dans la rediffusion, a partir de 1. */
  segmentIndex: number;
  /** Nombre de matchs detectes dans la meme rediffusion. */
  segmentCount: number;
  /** Identifiant commun a tous les matchs issus d'un meme fichier. */
  sessionId: string;
  map: MapIdentification;
  mapFingerprint?: MapFingerprint;
  /**
   * Vignette de la zone ou le nom de carte a ete cherche, en JPEG base64.
   * Elle permet au joueur de verifier d'un coup d'oeil que la zone du HUD est
   * bien cadree, au lieu de se demander pourquoi rien n'est reconnu.
   */
  mapNameCrop?: string;
  /**
   * Nom de carte lu a l'ecran par l'application, hors ligne.
   * Vide tant que rien n'a pu etre lu.
   */
  readMapName?: string;
  /** Mode de jeu lu a l'ecran par l'application. */
  readGameMode?: string;
  /** Issue de la manche, du point de vue de votre equipe. */
  outcome: MatchOutcome;
  /**
   * Ligne du joueur relevee sur le tableau des scores du jeu.
   *
   * Quand elle existe, elle fait autorite sur le marquage manuel et sur les
   * heuristiques : c'est le jeu lui-meme qui l'ecrit.
   */
  officialStats?: AiScoreRow;
  settings: AnalysisSettingsSnapshot;
  features: FrameFeature[];
  events: MatchEvent[];
  metrics: MatchMetrics;
  ai?: AiReport;
  notes: string;
}

/** Modeles Claude proposes dans les reglages. */
export const AI_MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 — analyse la plus fine' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — bon compromis cout / qualite' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — le moins cher, le plus rapide' },
] as const;

export interface AppSettings {
  apiKey: string;
  aiModel: string;
  aiEnabled: boolean;
  /** Images echantillonnees par seconde de video pour le moteur local. */
  samplingHz: number;
  /** Nombre maximum d'images envoyees a l'IA pour une analyse. */
  aiFrameBudget: number;
  defaultProfile: GameProfileId;
  playerName: string;
  /** Decouper automatiquement une rediffusion en matchs distincts. */
  autoSegment: boolean;
  /** Duree minimale d'un match retenu, en secondes. */
  minMatchS: number;
  /** Duree minimale d'une pause entre deux matchs, en secondes. */
  minGapS: number;
  /**
   * Utiliser les ecrans noirs du jeu comme frontieres de manche.
   * EVA en insere un apres le decompte de debut et apres le tableau des
   * scores : c'est un reperage bien plus sur que le seul mouvement.
   */
  useBlackScreens: boolean;
  /** Zone du HUD ou lire le nom de la carte. */
  mapNameRegion: HudRegion;
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  aiModel: 'claude-opus-5',
  aiEnabled: false,
  /**
   * Un voile de degats dure typiquement 0,3 a 0,5 s. En echantillonnant a
   * 2 Hz (une image toutes les 0,5 s) on en rate une bonne partie : 3 Hz
   * ramene l'intervalle a 0,33 s, sous la duree de l'evenement a detecter.
   */
  samplingHz: 3,
  aiFrameBudget: 24,
  defaultProfile: 'tdm',
  playerName: '',
  autoSegment: true,
  minMatchS: 90,
  minGapS: 40,
  useBlackScreens: true,
  mapNameRegion: { ...DEFAULT_MAP_NAME_REGION },
};
