import type { MatchAnalysis, MatchOutcome, Team, TeamSide } from './types';

/**
 * Issue d'une manche pour votre equipe.
 *
 * Le tableau des scores dit quel camp l'emporte, jamais lequel est le votre :
 * l'ordre des rangees suit le cote joue, pas le resultat. Il faut donc
 * combiner les deux. Tant que le camp n'est pas indique, l'issue reste
 * inconnue plutot que devinee.
 */
export function outcomeFor(analysis: MatchAnalysis): MatchOutcome {
  const gagnant = analysis.scoreboard?.winner;
  if (!gagnant || !analysis.mySide) return 'inconnue';
  if (gagnant === 'egalite') return 'egalite';
  return gagnant === analysis.mySide ? 'victoire' : 'defaite';
}

/**
 * Applique un camp a toutes les manches d'une meme rediffusion.
 *
 * Les equipes ne changent pas de cote au sein d'une rediffusion — au pire
 * entre deux rediffusions. Indiquer son camp une fois suffit donc pour tout le
 * fichier, ce qui evite de reposer huit fois la meme question.
 */
export function applySideToSession(
  analyses: readonly MatchAnalysis[],
  sessionId: string,
  side: TeamSide,
  opponentTeamId?: string,
): MatchAnalysis[] {
  return analyses.map((a) => {
    if (a.sessionId !== sessionId) return a;
    const suivant: MatchAnalysis = {
      ...a,
      mySide: side,
      ...(opponentTeamId ? { opponentTeamId } : {}),
    };
    return { ...suivant, outcome: outcomeFor(suivant) };
  });
}

export interface SessionGroup {
  sessionId: string;
  /** Titre du fichier source, sans le suffixe de manche. */
  title: string;
  /** Date d'analyse la plus ancienne du groupe, en ISO. */
  date: string;
  /** Equipe adverse si elle est connue. */
  opponent: Team | null;
  mySide: TeamSide | null;
  analyses: MatchAnalysis[];
  wins: number;
  losses: number;
  draws: number;
  unknown: number;
}

/**
 * Regroupe les manches par rediffusion, les plus recentes d'abord.
 *
 * C'est la maille qui a du sens pour le joueur : une rediffusion est une
 * soiree contre un adversaire donne, et son bilan se lit d'un coup d'oeil.
 */
export function groupBySession(
  analyses: readonly MatchAnalysis[],
  teams: readonly Team[],
): SessionGroup[] {
  const parSession = new Map<string, MatchAnalysis[]>();
  for (const a of analyses) {
    const liste = parSession.get(a.sessionId);
    if (liste) liste.push(a);
    else parSession.set(a.sessionId, [a]);
  }

  const groupes: SessionGroup[] = [];
  for (const [sessionId, liste] of parSession) {
    const triees = [...liste].sort((a, b) => a.segmentIndex - b.segmentIndex);
    const premiere = triees[0] as MatchAnalysis;
    const adverseId = triees.find((a) => a.opponentTeamId)?.opponentTeamId;
    groupes.push({
      sessionId,
      title: premiere.video.name || premiere.title,
      date: triees.reduce((min, a) => (a.createdAt < min ? a.createdAt : min), premiere.createdAt),
      opponent: teams.find((t) => t.id === adverseId) ?? null,
      mySide: premiere.mySide ?? null,
      analyses: triees,
      wins: triees.filter((a) => a.outcome === 'victoire').length,
      losses: triees.filter((a) => a.outcome === 'defaite').length,
      draws: triees.filter((a) => a.outcome === 'egalite').length,
      unknown: triees.filter((a) => a.outcome === 'inconnue').length,
    });
  }

  return groupes.sort((a, b) => b.date.localeCompare(a.date));
}

/** Bilan d'un groupe, sous la forme « 5 V – 3 D ». */
export function recordLabel(groupe: Pick<SessionGroup, 'wins' | 'losses' | 'draws' | 'unknown'>): string {
  const morceaux = [`${groupe.wins} V`, `${groupe.losses} D`];
  if (groupe.draws > 0) morceaux.push(`${groupe.draws} E`);
  if (groupe.unknown > 0) morceaux.push(`${groupe.unknown} ?`);
  return morceaux.join(' – ');
}
