import { useEffect, useState } from 'react';
import type { CalloutMap, QuizMode, QuizQuestion } from '../../core/callouts/quiz';
import { buildChoices, buildQuiz, nearestCallout, recordAnswer } from '../../core/callouts/quiz';
import { CalloutBoard, type MarkerTone } from './CalloutBoard';

interface CalloutQuizProps {
  map: CalloutMap;
  onChange: (map: CalloutMap) => void;
  onBack: () => void;
}

interface Answer {
  correct: boolean;
  /** Mode « trouver » : point touche et endroit auquel il correspond. */
  tap?: { x: number; y: number; calloutId: string };
  /** Mode « nommer » : nom choisi. */
  chosen?: string;
}

const MODES: Array<{ id: QuizMode; label: string; desc: string }> = [
  { id: 'trouver', label: 'Trouver', desc: 'Un nom est annonce, touchez son emplacement sur le plan.' },
  { id: 'nommer', label: 'Nommer', desc: 'Un endroit est montre, choisissez son nom.' },
];

const LENGTHS = [10, 20, 0];

/** Delai avant la question suivante apres une bonne reponse. */
const AUTO_NEXT_MS = 900;

export function CalloutQuiz({ map, onChange, onBack }: CalloutQuizProps) {
  const [mode, setMode] = useState<QuizMode>('trouver');
  const [length, setLength] = useState(10);
  const [showMarkers, setShowMarkers] = useState(true);
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [results, setResults] = useState<Array<{ calloutId: string; correct: boolean }>>([]);

  const question = questions?.[index] ?? null;
  const target = question ? map.callouts.find((c) => c.id === question.calloutId) ?? null : null;
  const done = questions !== null && index >= questions.length;

  const start = (qs: QuizQuestion[]) => {
    setQuestions(qs);
    setIndex(0);
    setAnswer(null);
    setResults([]);
  };

  const next = () => {
    setAnswer(null);
    setIndex((i) => i + 1);
  };

  useEffect(() => {
    if (!answer?.correct) return;
    const timer = window.setTimeout(next, AUTO_NEXT_MS);
    return () => window.clearTimeout(timer);
  }, [answer]);

  const submit = (result: Answer) => {
    if (!target || answer) return;
    setAnswer(result);
    setResults((r) => [...r, { calloutId: target.id, correct: result.correct }]);
    const now = new Date().toISOString();
    onChange({
      ...map,
      callouts: map.callouts.map((c) =>
        c.id === target.id ? { ...c, stats: recordAnswer(c.stats, result.correct, now) } : c,
      ),
    });
  };

  const onTap = (x: number, y: number) => {
    if (mode !== 'trouver' || !target || answer) return;
    const nearest = nearestCallout(map, x, y);
    if (!nearest) return;
    // Deux endroits du meme nom sont indiscernables a la voix : l'un vaut l'autre.
    const correct = nearest.id === target.id || nearest.name === target.name;
    submit({ correct, tap: { x, y, calloutId: nearest.id } });
  };

  // ---------- Reglage de la serie ----------

  if (!questions) {
    return (
      <>
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="btn-ghost" onClick={onBack}>
            ← Cartes
          </button>
        </div>
        <div className="card" style={{ maxWidth: 560 }}>
          <h1>{map.name}</h1>
          <p className="hint">{map.callouts.length} endroits a connaitre.</p>

          <h2>Mode</h2>
          <div className="quiz-modes">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={`quiz-mode${mode === m.id ? ' is-active' : ''}`}
                onClick={() => setMode(m.id)}
              >
                <b>{m.label}</b>
                <span>{m.desc}</span>
              </button>
            ))}
          </div>

          <h2 style={{ marginTop: 18 }}>Questions</h2>
          <div className="row" style={{ marginBottom: 14 }}>
            {LENGTHS.map((n) => (
              <button
                key={n}
                className="btn-ghost"
                style={length === n ? { borderColor: 'var(--accent-dim)', color: 'var(--accent)' } : {}}
                onClick={() => setLength(n)}
              >
                {n === 0 ? 'Toutes' : n}
              </button>
            ))}
          </div>

          {mode === 'trouver' && (
            <label className="row" style={{ marginBottom: 16, gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showMarkers}
                onChange={(e) => setShowMarkers(e.target.checked)}
              />
              <span>Afficher les reperes (sans leur nom)</span>
            </label>
          )}

          <button
            className="btn"
            onClick={() =>
              start(buildQuiz(map, mode, length === 0 ? map.callouts.length : length))
            }
          >
            Commencer
          </button>
        </div>
      </>
    );
  }

  // ---------- Bilan ----------

  if (done) {
    const bons = results.filter((r) => r.correct).length;
    const rates = [...new Set(results.filter((r) => !r.correct).map((r) => r.calloutId))]
      .map((id) => map.callouts.find((c) => c.id === id))
      .filter((c) => c !== undefined);
    const pct = results.length ? Math.round((bons / results.length) * 100) : 0;

    return (
      <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
        <h1>
          {bons} / {results.length}
        </h1>
        <p className="hint">
          {pct === 100 ? 'Sans faute.' : pct >= 70 ? 'Bonne serie.' : 'A retravailler.'} Les endroits
          rates reviendront plus souvent dans les prochaines series.
        </p>
        {rates.length > 0 && (
          <>
            <h2>A revoir</h2>
            <div className="callout-list" style={{ marginBottom: 16 }}>
              {rates.map((c) => (
                <div key={c.id} className="callout-item">
                  <span>{c.name}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="row">
          {rates.length > 0 && (
            <button
              className="btn"
              onClick={() =>
                start(
                  rates.map((c) => ({
                    calloutId: c.id,
                    choices: mode === 'nommer' ? buildChoices(map, c, 4) : [],
                  })),
                )
              }
            >
              Rejouer les erreurs
            </button>
          )}
          <button className="btn-ghost" onClick={() => setQuestions(null)}>
            Nouvelle serie
          </button>
          <button className="btn-ghost" onClick={onBack}>
            Terminer
          </button>
        </div>
      </div>
    );
  }

  // ---------- Question ----------

  if (!target) {
    // Endroit supprime entre-temps : on passe.
    return (
      <div className="card empty">
        <button className="btn" onClick={next}>
          Question suivante
        </button>
      </div>
    );
  }

  const markers: Array<{ callout: typeof target; tone: MarkerTone; label?: boolean }> = [];
  if (mode === 'trouver') {
    for (const c of map.callouts) {
      if (answer && c.id === target.id) {
        markers.push({ callout: c, tone: 'ok', label: true });
      } else if (answer && c.id === answer.tap?.calloutId) {
        markers.push({ callout: c, tone: 'bad', label: true });
      } else if (showMarkers) {
        markers.push({ callout: c, tone: 'neutral' });
      }
    }
  } else {
    markers.push({ callout: target, tone: answer ? (answer.correct ? 'ok' : 'bad') : 'target', label: !!answer });
  }

  const bonnes = results.filter((r) => r.correct).length;

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn-ghost" onClick={() => setQuestions(null)}>
          Abandonner
        </button>
        <div className="spacer" />
        <span className="tag">
          {index + 1} / {questions.length}
        </span>
        <span className="tag" style={{ color: 'var(--ok)', borderColor: 'var(--ok)' }}>
          {bonnes} bonne{bonnes > 1 ? 's' : ''}
        </span>
      </div>

      <div className="quiz-prompt">
        {mode === 'trouver' ? (
          <>
            <span>Ou est</span>
            <strong>{target.name}</strong>
          </>
        ) : (
          <span>Quel est le nom de cet endroit ?</span>
        )}
      </div>

      <CalloutBoard
        map={map}
        markers={markers}
        onTap={mode === 'trouver' && !answer ? onTap : undefined}
        overlay={
          answer?.tap && !answer.correct ? (
            <i
              className="cmap-tap"
              style={{ left: `${answer.tap.x * 100}%`, top: `${answer.tap.y * 100}%` }}
            />
          ) : null
        }
      />

      {mode === 'nommer' && (
        <div className="quiz-choices">
          {question!.choices.map((name) => {
            let cls = 'quiz-choice';
            if (answer && name === target.name) cls += ' is-ok';
            else if (answer && name === answer.chosen) cls += ' is-bad';
            return (
              <button
                key={name}
                className={cls}
                disabled={!!answer}
                onClick={() => submit({ correct: name === target.name, chosen: name })}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}

      {answer && (
        <div className={`banner ${answer.correct ? 'banner-ok' : 'banner-error'} quiz-feedback`}>
          <span>
            {answer.correct
              ? 'Exact !'
              : mode === 'trouver'
                ? `Non : vous avez touche ${map.callouts.find((c) => c.id === answer.tap?.calloutId)?.name ?? '?'}.`
                : `Non : c'est ${target.name}.`}
          </span>
          {!answer.correct && (
            <button className="btn" onClick={next}>
              Suivant
            </button>
          )}
        </div>
      )}
    </>
  );
}
