import type { MatchAnalysis } from '../../core/types';
import { GAME_PROFILES } from '../../core/types';
import { formatDuration } from '../../core/analysis/metrics';

interface LibraryScreenProps {
  analyses: readonly MatchAnalysis[];
  onOpen: (analysis: MatchAnalysis) => void;
  onDelete: (analysis: MatchAnalysis) => void;
  onNew: () => void;
}

export function LibraryScreen({ analyses, onOpen, onDelete, onNew }: LibraryScreenProps) {
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
          : `${analyses.length} analyse${analyses.length > 1 ? 's' : ''} enregistree${analyses.length > 1 ? 's' : ''} sur cet appareil.`}
      </p>

      {analyses.length === 0 ? (
        <div className="card empty">
          <p>Aucun match analyse pour l'instant.</p>
          <button className="btn" onClick={onNew}>
            Charger une premiere video
          </button>
        </div>
      ) : (
        <div className="library">
          {analyses.map((a) => (
            <div className="match-card" key={a.id}>
              <h3>{a.title}</h3>
              <div className="sub">
                {GAME_PROFILES[a.profile].name} · {new Date(a.createdAt).toLocaleDateString('fr-FR')}
              </div>
              <div className="stats">
                <span>{formatDuration(a.metrics.durationS)}</span>
                <span>{a.metrics.engagementCount} phases</span>
                <span>{Math.round(a.metrics.activeRatio * 100)} % actif</span>
              </div>
              <div className="row">
                {a.ai ? <span className="tag">Analyse IA</span> : <span className="tag">Local seul</span>}
                {a.events.some((e) => e.source === 'manual') && <span className="tag">Annote</span>}
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
      )}
    </>
  );
}
