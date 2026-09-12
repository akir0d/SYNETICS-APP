import type { AiReport } from '../../core/types';
import { formatDuration } from '../../core/analysis/metrics';

interface AiPanelProps {
  report: AiReport | undefined;
  busy: boolean;
  enabled: boolean;
  error: string | null;
  onRun: () => void;
  onSeek: (t: number) => void;
}

export function AiPanel({ report, busy, enabled, error, onRun, onSeek }: AiPanelProps) {
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Analyse IA</h2>
        <div className="spacer" />
        <button className="btn" onClick={onRun} disabled={busy || !enabled}>
          {busy ? 'Analyse en cours...' : report ? 'Relancer' : 'Lancer l analyse IA'}
        </button>
      </div>

      {!enabled && (
        <div className="banner banner-info">
          L'analyse IA est desactivee. Activez-la et renseignez une cle API Anthropic dans les
          Reglages. Les mesures locales ci-dessus fonctionnent sans cle et sans reseau.
        </div>
      )}

      {error && <div className="banner banner-error">{error}</div>}

      {busy && (
        <p className="hint">
          Envoi des images cles au modele, puis lecture de sa reponse structuree. Comptez quelques
          dizaines de secondes.
        </p>
      )}

      {!report && !busy && enabled && !error && (
        <p className="hint">
          L'IA lit les images cles extraites de votre video et les croise avec les mesures locales
          pour produire une synthese de coach.
        </p>
      )}

      {report && (
        <>
          <p className="hint" style={{ marginBottom: 10 }}>
            {report.model} · {report.framesUsed} images ·{' '}
            {new Date(report.generatedAt).toLocaleString('fr-FR')}
            {report.usage
              ? ` · ${report.usage.inputTokens} jetons entree / ${report.usage.outputTokens} sortie`
              : ''}
          </p>

          <p style={{ marginTop: 0 }}>{report.summary}</p>

          <h3>Points forts</h3>
          <ul className="ai-list">
            {report.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>

          <h3>Axes de progres</h3>
          <ul className="ai-list">
            {report.weaknesses.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>

          <h3>Exercices pour la prochaine session</h3>
          {report.drills.map((d, i) => (
            <div className="drill" key={i}>
              <b>{d.title}</b>
              <span className="focus">{d.focus}</span>
              <p>{d.description}</p>
            </div>
          ))}

          {report.timeline.length > 0 && (
            <>
              <h3>Moments repere par l'IA</h3>
              <div className="event-list" style={{ maxHeight: 260 }}>
                {report.timeline.map((note, i) => (
                  <div
                    key={i}
                    className="event"
                    role="button"
                    tabIndex={0}
                    onClick={() => onSeek(note.t)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onSeek(note.t);
                    }}
                  >
                    <time>{formatDuration(note.t)}</time>
                    <div>
                      <div className="title">{note.label}</div>
                      <div className="meta">{note.comment}</div>
                    </div>
                    <span className="badge">{Math.round(note.confidence * 100)} %</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="banner banner-info" style={{ marginTop: 14 }}>
            <strong>Limites signalees par l'IA :</strong> {report.caveats}
          </div>
        </>
      )}
    </div>
  );
}
