import { z } from 'zod';

/**
 * Entrainement aux noms des endroits d'une carte (les « callouts »).
 *
 * Comme pour la reconnaissance d'arene, l'application n'embarque aucun plan :
 * le joueur importe une image de la carte (capture, schema dessine par
 * l'equipe) et y pose lui-meme les noms. Le quiz s'appuie ensuite sur ces
 * reperes, et une carte s'exporte en un fichier pour toute l'equipe.
 *
 * Module pur : aucune dependance DOM, il porte les tests.
 */

/** Suivi d'apprentissage d'un endroit. */
export interface CalloutStats {
  seen: number;
  correct: number;
  /** Bonnes reponses consecutives ; retombe a zero a la premiere erreur. */
  streak: number;
  /** Date ISO de la derniere question posee, vide si jamais posee. */
  lastSeen: string;
}

export interface Callout {
  id: string;
  name: string;
  /** Position sur l'image, en fraction de sa largeur (0 a 1). */
  x: number;
  /** Position sur l'image, en fraction de sa hauteur (0 a 1). */
  y: number;
  stats: CalloutStats;
}

export interface CalloutMap {
  id: string;
  name: string;
  /** Image du plan, en data URL : la carte reste autonome et partageable. */
  image: string;
  /** Rapport largeur / hauteur de l'image, pour convertir les distances. */
  aspect: number;
  callouts: Callout[];
  /** Plan annote (avec les noms), affiche pour reviser. Facultatif. */
  reference?: string;
  /**
   * Version du catalogue pour une carte livree avec l'application. Absent
   * pour une carte creee par le joueur. Une carte du catalogue ne se modifie
   * pas : elle est remise a jour avec l'application.
   */
  builtin?: number;
  createdAt: string;
  updatedAt: string;
}

export type QuizMode = 'trouver' | 'nommer';

export const EMPTY_STATS: CalloutStats = { seen: 0, correct: 0, streak: 0, lastSeen: '' };

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Distance entre deux points de l'image, corrigee du rapport largeur/hauteur :
 * sans cela, sur un plan tres large, un ecart horizontal compterait moins
 * qu'un ecart vertical de meme longueur a l'ecran.
 */
function distance(aspect: number, ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot((ax - bx) * aspect, ay - by);
}

/**
 * Endroit le plus proche d'un point touche.
 *
 * Le mode « trouver » ne juge pas sur un rayon fixe autour du repere : il
 * attribue chaque point de la carte a l'endroit le plus proche. Une grande
 * salle isolee tolere donc un toucher approximatif, deux recoins voisins
 * exigent de la precision — comme a la voix en partie.
 */
export function nearestCallout(
  map: Pick<CalloutMap, 'aspect' | 'callouts'>,
  x: number,
  y: number,
): Callout | null {
  let best: Callout | null = null;
  let bestD = Infinity;
  for (const c of map.callouts) {
    const d = distance(map.aspect, x, y, c.x, c.y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Part de bonnes reponses, 0 si l'endroit n'a jamais ete demande. */
export function accuracy(stats: CalloutStats): number {
  return stats.seen === 0 ? 0 : stats.correct / stats.seen;
}

/** Un endroit est acquis apres trois bonnes reponses d'affilee. */
export const MASTERY_STREAK = 3;

export function isMastered(stats: CalloutStats): boolean {
  return stats.streak >= MASTERY_STREAK;
}

/**
 * Priorite d'un endroit dans la prochaine serie : plus elle est haute, plus
 * il a de chances de tomber. Les endroits jamais vus et les erreurs recentes
 * passent devant ; un endroit acquis revient quand meme, plus rarement, pour
 * ne pas s'oublier.
 */
export function priority(stats: CalloutStats): number {
  if (stats.seen === 0) return 3;
  const echecs = 1 - accuracy(stats);
  return 0.4 + 2 * echecs + Math.max(0, MASTERY_STREAK - stats.streak) * 0.3;
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/**
 * Propositions du mode « nommer ». Les leurres sont pris parmi les voisins
 * les plus proches de la bonne reponse : distinguer deux pieces eloignees est
 * trivial, ce sont les endroits contigus que l'on confond en partie.
 */
export function buildChoices(
  map: Pick<CalloutMap, 'aspect' | 'callouts'>,
  target: Callout,
  count: number,
  random: () => number = Math.random,
): string[] {
  const voisins = map.callouts
    .filter((c) => c.id !== target.id && c.name !== target.name)
    .map((c) => ({ c, d: distance(map.aspect, c.x, c.y, target.x, target.y) }))
    .sort((a, b) => a.d - b.d);

  // Un peu de hasard parmi les plus proches, pour que les memes leurres ne
  // reviennent pas a chaque fois.
  const proches = shuffle(voisins.slice(0, (count - 1) * 2), random).slice(0, count - 1);
  const noms = new Set<string>([target.name]);
  for (const { c } of proches) noms.add(c.name);
  for (const { c } of voisins) {
    if (noms.size >= count) break;
    noms.add(c.name);
  }
  return shuffle([...noms], random);
}

/** Met a jour le suivi d'un endroit apres une reponse. */
export function recordAnswer(stats: CalloutStats, correct: boolean, now: string): CalloutStats {
  return {
    seen: stats.seen + 1,
    correct: stats.correct + (correct ? 1 : 0),
    streak: correct ? stats.streak + 1 : 0,
    lastSeen: now,
  };
}

/** Le nombre minimal d'endroits pour qu'un quiz ait un sens. */
export const MIN_CALLOUTS = 2;

// ---------------------------------------------------------------------------
// Partage : une carte s'echange en un fichier JSON.

const FORMAT = 'synetics-callouts';

const ImportSchema = z.object({
  format: z.literal(FORMAT),
  version: z.literal(1),
  name: z.string().min(1),
  image: z.string().startsWith('data:image/'),
  aspect: z.number().positive(),
  reference: z.string().startsWith('data:image/').optional(),
  callouts: z.array(
    z.object({
      name: z.string().min(1),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    }),
  ),
});

/** Contenu du fichier exporte. Le suivi d'apprentissage reste personnel. */
export function exportCalloutMap(map: CalloutMap): string {
  return JSON.stringify(
    {
      format: FORMAT,
      version: 1,
      name: map.name,
      image: map.image,
      aspect: map.aspect,
      reference: map.reference,
      callouts: map.callouts.map(({ name, x, y }) => ({ name, x, y })),
    },
    null,
    1,
  );
}

/**
 * Relit un fichier exporte. Leve une erreur lisible si le fichier n'est pas
 * une carte de callouts : un import ne doit jamais laisser une carte a moitie
 * valide dans la bibliotheque.
 */
export function importCalloutMap(text: string, now: string): CalloutMap {
  let brut: unknown;
  try {
    brut = JSON.parse(text);
  } catch {
    throw new Error("Ce fichier n'est pas du JSON.");
  }
  const parsed = ImportSchema.safeParse(brut);
  if (!parsed.success) throw new Error("Ce fichier n'est pas une carte de callouts SYNETICS.");
  const d = parsed.data;
  return {
    id: newId('callmap'),
    name: d.name,
    image: d.image,
    aspect: d.aspect,
    reference: d.reference,
    callouts: d.callouts.map((c) => ({ id: newId('call'), ...c, stats: { ...EMPTY_STATS } })),
    createdAt: now,
    updatedAt: now,
  };
}
