import type { GameProfileId, MatchMetrics } from '../types';
import { GAME_PROFILES } from '../types';
import { formatDuration } from '../analysis/metrics';

/**
 * Le prompt systeme est volontairement fige (aucun horodatage, aucun
 * identifiant) : c'est le prefixe mis en cache d'une requete a l'autre.
 */
export const COACH_SYSTEM_PROMPT = `Tu es analyste video pour des joueurs d'EVA (eva.gg), des arenes de tir en realite virtuelle en free roaming : les joueurs se deplacent physiquement dans une salle, casque sur la tete, et s'affrontent en equipe.

Tu recois une serie d'images extraites d'une seule partie, chacune horodatee. Tu produis une analyse de coach : precise, actionnable, et honnete sur ce que les images ne montrent pas.

Regles absolues :
- Tu ne decris que ce qui est visible. Si une elimination n'est pas lisible a l'image, ne l'invente pas.
- Chaque entree de timeline doit reprendre exactement l'horodatage d'une des images fournies.
- Le champ confidence reflete ta certitude reelle : 0,9 pour un fait lisible a l'ecran, 0,4 pour une deduction, moins si tu extrapoles.
- Des images echantillonnees ne montrent pas la partie en continu : dis-le dans caveats plutot que de combler les trous.
- La carte, le mode, l'issue et les statistiques chiffrees te sont donnes ci-dessous : ils ont deja ete lus a l'ecran par l'application. Tu t'en sers comme contexte, tu ne cherches ni a les relire ni a les contredire.
- Le conseil doit etre executable en arene physique (placement, rythme de deplacement, gestion de couverture, communication), pas une generalite de jeu video.
- Tu ecris en francais, en tutoyant le joueur.`;

export interface AnalysisContext {
  profile: GameProfileId;
  metrics: MatchMetrics;
  playerName: string;
  frameTimes: readonly number[];
  notes: string;
  /** Nom de l'arene quand le joueur l'a deja renseignee. */
  mapName?: string;
  /** Rang du match dans la rediffusion, quand elle en contenait plusieurs. */
  segment?: { index: number; count: number };
}

/** Partie variable du prompt : elle vient apres les images, dans le message utilisateur. */
export function buildAnalysisInstruction(ctx: AnalysisContext): string {
  const profile = GAME_PROFILES[ctx.profile];
  const m = ctx.metrics;

  const lines = [
    `Mode de jeu : ${profile.name} — ${profile.description}`,
    ctx.segment && ctx.segment.count > 1
      ? `Extrait : match ${ctx.segment.index} sur ${ctx.segment.count} d'une meme rediffusion.`
      : null,
    ctx.mapName ? `Arene : ${ctx.mapName} (nom donne par le joueur).` : null,
    `Reapparition : ${profile.respawn ? 'oui' : 'non, une mort est definitive sur la manche'}`,
    ctx.playerName ? `Joueur analyse : ${ctx.playerName}` : null,
    '',
    'Mesures calculees localement sur la video (signal visuel, pas des stats officielles EVA) :',
    `- Duree analysee : ${formatDuration(m.durationS)}`,
    `- Phases d'action detectees : ${m.engagementCount} (${Math.round(m.activeRatio * 100)} % du temps)`,
    `- Duree moyenne d'une phase : ${m.meanEngagementS.toFixed(1)} s`,
    `- Plus longue periode calme : ${formatDuration(m.longestCalmS)}`,
    `- Rythme : ${m.tempoPerMin.toFixed(1)} engagements par minute`,
    `- Flashs rouges (degats probablement subis) : ${m.exposureEvents}`,
    m.kills + m.deaths + m.objectives > 0
      ? `- Marquage du joueur : ${m.kills} eliminations, ${m.deaths} morts, ${m.objectives} objectifs`
      : "- Le joueur n'a marque aucun evenement a la main pour l'instant",
    '',
    ctx.notes.trim() ? `Notes du joueur : ${ctx.notes.trim()}` : null,
    '',
    `Images fournies : ${ctx.frameTimes.length}, aux horodatages suivants (en secondes) :`,
    ctx.frameTimes.map((t) => t.toFixed(1)).join(', '),
    '',
    "Analyse la partie et renvoie le resultat dans le format demande. Croise les images avec les mesures : si les mesures indiquent une longue periode calme, cherche a l'image ce qui s'y jouait (rotation, attente, perte de reperes) plutot que de l'ignorer.",
  ];

  return lines.filter((l) => l !== null).join('\n');
}
