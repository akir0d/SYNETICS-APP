import type { MatchAnalysis, Team, TeamSide } from '../../core/types';
import { GAME_PROFILES, OUTCOME_LABELS } from '../../core/types';
import { formatDuration } from '../../core/analysis/metrics';
import { groupBySession, recordLabel, type SessionGroup } from '../../core/match';

interface LibraryScreenProps {
  analyses: readonly MatchAnalysis[];
  teams: readonly Team[];
  myTeamId: string;
  onOpen: (analysis: MatchAnalysis) => void;
  onDelete: (analysis: MatchAnalysis) => void;
  onNew: () => void;
  /** Indique le camp de votre equipe pour toute une rediffusion. */
  onSetSide: (sessionId: string, side: TeamSide, opponentTeamId?: string) => void;
}

const OUTCOME_COLOR: Record<string, string> = {
  victoire: 'var(--ok)',
  defaite: 'var(--danger)',
  egalite: 'var(--border-strong)',
};

function OutcomeTag({ outcome }: { outcome: MatchAnalysis['outcome'] }) {
  if (outcome === 'inconnue') return null;
  const couleur = OUTCOME_COLOR[outcome] ?? 'var(--border-strong)';
  return (
    <span className="tag" style={{ color: couleur, borderColor: couleur }}>
      {OUTCOME_LABELS[outcome]}
    </span>
  );
}

/**
 * Bandeau de rediffusion : le bilan, et la question qui le rend possible.
 *
 * Le tableau des scores dit quel camp l'emporte mais pas lequel est le votre,
 * et l'ordre des rangees suit le cote joue, pas le resultat. Une indication
 * suffit pourtant pour tout le fichier, les equipes ne changeant pas de cote
 * au sein d'une rediffusion.
 */
function SessionHeader({
  groupe,
  teams,
  myTeamId,
  onSetSide,
}: {
  groupe: SessionGroup;
  teams: readonly Team[];
  myTeamId: string;
  onSetSide: LibraryScreenProps['onSetSide'];
}) {
  const mienne = teams.find((t) => t.id === myTeamId);
  const lisible = groupe.analyses.some((a) => a.scoreboard);
  const adverses = teams.filter((t) => t.id !== myTeamId);

  return (
    <div className="row" style={{ alignItems: 'baseline', marginBottom: 8, flexWrap: 'wrap' }}>
      <h2 style={{ margin: 0, fontSize: 17 }}>{groupe.title}</h2>
      <span className="tag">{new Date(groupe.date).toLocaleDateString('fr-FR')}</span>
      <span className="tag">
        {groupe.analyses.length} manche{groupe.analyses.length > 1 ? 's' : ''}
      </span>
      {groupe.opponent && <span className="tag">contre {groupe.opponent.name || groupe.opponent.tag}</span>}
      <span className="tag" style={{ fontWeight: 600 }}>
        {recordLabel(groupe)}
      </span>
      <div className="spacer" />

      {lisible && (
        <>
          <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
            {mienne ? `${mienne.tag} joue en` : 'Votre equipe joue en'}
          </span>
          {(['haut', 'bas'] as TeamSide[]).map((side) => (
            <button
              key={side}
              className="btn-ghost"
              style={{
                padding: '4px 12px',
                ...(groupe.mySide === side ? { borderColor: 'var(--ok)', color: 'var(--ok)' } : {}),
              }}
              onClick={() => onSetSide(groupe.sessionId, side)}
            >
              {side === 'haut' ? 'rangee du haut' : 'rangee du bas'}
            </button>
          ))}
          {adverses.length > 0 && (
            <select
              value={groupe.opponent?.id ?? ''}
              onChange={(e) =>
                onSetSide(groupe.sessionId, groupe.mySide ?? 'haut', e.target.value || undefined)
              }
            >
              <option value="">Adversaire —</option>
              {adverses.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name || t.tag}
                </option>
              ))}
            </select>
          )}
        </>
      )}
    </div>
  );
}

export function LibraryScreen({
  analyses,
  teams,
  myTeamId,
  onOpen,
  onDelete,
  onNew,
  onSetSide,
}: LibraryScreenProps) {
  const groupes = groupBySession(analyses, teams);

  return (
    <>
      <div className="row" style={{ marginBottom: 6 }}>
        <h1 style={{ margin: 0 }}>Bibliotheque</h1>
        <div className="spacer" />
        <button className="btn" onClick={onNew}>
          Analyser un match
        </button>
      </div>
      <p className="hint">
        {analyses.length === 0
          ? 'Vos analyses sont enregistrees sur cet appareil.'
          : `${analyses.length} manche${analyses.length > 1 ? 's' : ''} sur ${groupes.length} rediffusion${groupes.length > 1 ? 's' : ''}, enregistrees sur cet appareil.`}
      </p>

      {analyses.length === 0 ? (
        <div className="card empty">
          <p>Aucun match analyse pour l'instant.</p>
          <button className="btn" onClick={onNew}>
            Charger une premiere video
          </button>
        </div>
      ) : (
        groupes.map((groupe) => (
          <div key={groupe.sessionId} style={{ marginBottom: 22 }}>
            <SessionHeader groupe={groupe} teams={teams} myTeamId={myTeamId} onSetSide={onSetSide} />
            <div className="library">
              {groupe.analyses.map((a) => (
                <div className="match-card" key={a.id}>
                  <h3>
                    {a.segmentCount > 1 ? `Manche ${a.segmentIndex}` : a.title}
                    {a.map.mapName ? ` — ${a.map.mapName}${a.map.confirmed ? '' : ' ?'}` : ''}
                  </h3>
                  <div className="sub">
                    {GAME_PROFILES[a.profile].name} · {formatDuration(a.metrics.durationS)}
                  </div>
                  {a.scoreboard && (
                    <div className="stats">
                      <span>
                        {a.scoreboard.percents.map((p) => (p === null ? '?' : `${p} %`)).join(' — ')}
                      </span>
                      <span>
                        {a.scoreboard.totals.map((t) => (t === null ? '?' : `${t}`)).join(' — ')} pts
                      </span>
                    </div>
                  )}
                  <div className="row">
                    <OutcomeTag outcome={a.outcome} />
                    {a.scoreboard && !a.scoreboard.agreed && (
                      <span className="tag" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>
                        Lecture douteuse
                      </span>
                    )}
                    {!a.scoreboard && <span className="tag">Tableau non lu</span>}
                    {a.ai && <span className="tag">Analyse IA</span>}
                  </div>
                  <div className="row">
                    <button className="btn-ghost" onClick={() => onOpen(a)}>
                      Ouvrir
                    </button>
                    <div className="spacer" />
                    <button className="btn-ghost btn-danger" onClick={() => onDelete(a)}>
                      Supprimer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}
