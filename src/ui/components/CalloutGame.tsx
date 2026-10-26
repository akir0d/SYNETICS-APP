import { useEffect, useMemo, useState } from 'react';
import type { Callout, CalloutMap, QuizMode } from '../../core/callouts/quiz';
import { buildChoices, nearestCallout, recordAnswer } from '../../core/callouts/quiz';
import {
  SERIES_LENGTH,
  START_LIVES,
  applyAnswer,
  buildPool,
  itemKey,
  loadRecords,
  newGame,
  pickNext,
  pointsFor,
  recordKey,
  submitRecord,
  type GameItem,
  type GameLength,
  type GameState,
} from '../../core/callouts/game';
import { CalloutBoard, type MarkerTone } from './CalloutBoard';

interface CalloutGameProps {
  /** Cartes en jeu : une seule, ou toutes. */
  maps: readonly CalloutMap[];
  /** Identifiant du perimetre, pour les records : id de carte ou `all`. */
  scope: string;
  title: string;
  onChange: (map: CalloutMap) => void;
  onBack: () => void;
}

type GameMode = QuizMode | 'mixte';

interface Question {
  item: GameItem;
  mode: QuizMode;
  choices: string[];
}

interface Answer {
  correct: boolean;
  points: number;
  /** Mode « trouver » : point touche et endroit auquel il correspond. */
  tap?: { x: number; y: number; calloutId: string };
  /** Mode « nommer » : nom choisi. */
  chosen?: string;
}

const MODES: Array<{ id: GameMode; label: string; desc: string }> = [
  { id: 'trouver', label: 'Trouver', desc: 'Un call est annonce : touchez son emplacement.' },
  { id: 'nommer', label: 'Nommer', desc: 'Un endroit clignote : choisissez son call.' },
  { id: 'mixte', label: 'Mixte', desc: 'Les deux, au hasard.' },
];

const LENGTHS: Array<{ value: GameLength; label: string }> = [
  { value: SERIES_LENGTH, label: `${SERIES_LENGTH} questions` },
  { value: null, label: 'Infini' },
];

/** Delai avant la question suivante apres une bonne reponse. */
const AUTO_NEXT_MS = 800;

export function CalloutGame({ maps, scope, title, onChange, onBack }: CalloutGameProps) {
  const [mode, setMode] = useState<GameMode>('trouver');
  const [length, setLength] = useState<GameLength>(SERIES_LENGTH);
  const [showMarkers, setShowMarkers] = useState(true);
  const [records, setRecords] = useState(loadRecords);

  const [game, setGame] = useState<GameState | null>(null);
  /** Restreint la partie a certains endroits (revision des erreurs). */
  const [only, setOnly] = useState<Set<string> | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [missed, setMissed] = useState<string[]>([]);
  const [previousRecord, setPreviousRecord] = useState(0);

  const pool = useMemo(() => {
    const all = buildPool(maps);
    return only ? all.filter((i) => only.has(itemKey(i))) : all;
  }, [maps, only]);

  const mapOf = (id: string) => maps.find((m) => m.id === id);
  const multi = maps.length > 1;
  const effectiveLength: GameLength = only ? Math.min(only.size, SERIES_LENGTH) : length;
  const key = recordKey(scope, mode, effectiveLength);

  const ask = (state: GameState) => {
    const item = pickNext(pool, state.asked, effectiveLength);
    if (!item) return;
    const qMode: QuizMode = mode === 'mixte' ? (Math.random() < 0.5 ? 'trouver' : 'nommer') : mode;
    const map = mapOf(item.mapId);
    setQuestion({
      item,
      mode: qMode,
      choices: qMode === 'nommer' && map ? buildChoices(map, item.callout, 4) : [],
    });
    setAnswer(null);
  };

  const start = (restrict: Set<string> | null) => {
    setOnly(restrict);
    setMissed([]);
    setQuestion(null);
    setAnswer(null);
    setGame(newGame());
  };

  // Premiere question, une fois le perimetre (et donc le pool) en place.
  useEffect(() => {
    if (game && game.answered === 0 && !question) ask(game);
  }, [game, question, pool]);

  /** Retour aux reglages : la revision des erreurs ne vaut que pour une partie. */
  const quit = () => {
    setGame(null);
    setOnly(null);
  };

  const next = () => {
    if (!game) return;
    if (game.over) {
      setQuestion(null);
      return;
    }
    ask(game);
  };

  useEffect(() => {
    if (!answer?.correct) return;
    const timer = window.setTimeout(next, AUTO_NEXT_MS);
    return () => window.clearTimeout(timer);
  }, [answer]);

  const submit = (result: Omit<Answer, 'points'>) => {
    if (!game || !question || answer) return;
    const { item } = question;
    const after = applyAnswer(game, item, result.correct, effectiveLength);
    setAnswer({ ...result, points: after.score - game.score });
    setGame(after);
    if (!result.correct) setMissed((m) => (m.includes(itemKey(item)) ? m : [...m, itemKey(item)]));
    if (after.over && !only) {
      setPreviousRecord(submitRecord(key, after.score));
      setRecords(loadRecords());
    }

    const map = mapOf(item.mapId);
    if (map) {
      const now = new Date().toISOString();
      onChange({
        ...map,
        callouts: map.callouts.map((c) =>
          c.id === item.callout.id ? { ...c, stats: recordAnswer(c.stats, result.correct, now) } : c,
        ),
      });
    }
  };

  const onTap = (x: number, y: number) => {
    if (!question || question.mode !== 'trouver' || answer) return;
    const map = mapOf(question.item.mapId);
    if (!map) return;
    const nearest = nearestCallout(map, x, y);
    if (!nearest) return;
    const target = question.item.callout;
    // Deux endroits du meme nom sont indiscernables a la voix : l'un vaut l'autre.
    const correct = nearest.id === target.id || nearest.name === target.name;
    submit({ correct, tap: { x, y, calloutId: nearest.id } });
  };

  // ---------- Reglage de la partie ----------

  if (!game) {
    return (
      <>
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="btn-ghost" onClick={onBack}>
            ← Cartes
          </button>
        </div>
        <div className="card" style={{ maxWidth: 600 }}>
          <h1>{title}</h1>
          <p className="hint">
            {pool.length} calls{multi ? ` sur ${maps.length} cartes` : ''}. {START_LIVES} vies : une
            erreur en coute une. Les bonnes reponses enchainees rapportent de plus en plus.
          </p>

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

          <h2 style={{ marginTop: 18 }}>Format</h2>
          <div className="quiz-modes" style={{ marginBottom: 14 }}>
            {LENGTHS.map((l) => (
              <button
                key={l.label}
                className={`quiz-mode${length === l.value ? ' is-active' : ''}`}
                onClick={() => setLength(l.value)}
              >
                <b>{l.label}</b>
                <span>Record : {records[recordKey(scope, mode, l.value)] ?? 0} pts</span>
              </button>
            ))}
          </div>

          {mode !== 'nommer' && (
            <label className="row" style={{ marginBottom: 16, gap: 8, cursor: 'pointer', flexWrap: 'nowrap' }}>
              <input
                type="checkbox"
                checked={showMarkers}
                onChange={(e) => setShowMarkers(e.target.checked)}
              />
              <span>Afficher les reperes (sans leur nom) en mode Trouver</span>
            </label>
          )}

          <button className="btn" disabled={pool.length < 2} onClick={() => start(null)}>
            Jouer
          </button>
        </div>
      </>
    );
  }

  // ---------- Fin de partie ----------

  if (game.over && !question) {
    const pct = game.answered ? Math.round((game.correct / game.answered) * 100) : 0;
    const nouveauRecord = !only && game.score > previousRecord && game.score > 0;
    const rates = missed
      .map((k) => buildPool(maps).find((i) => itemKey(i) === k))
      .filter((i): i is GameItem => i !== undefined);

    return (
      <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
        <p className="hint" style={{ marginBottom: 4 }}>
          {game.lives <= 0 ? 'Plus de vies' : 'Serie terminee'}
          {only ? ' · revision des erreurs' : ''}
        </p>
        <div className="game-final">{game.score} pts</div>
        {nouveauRecord && <div className="banner banner-ok">Nouveau record !</div>}
        {!only && !nouveauRecord && previousRecord > 0 && (
          <p className="hint">Record : {previousRecord} pts</p>
        )}
        <div className="metric-grid" style={{ marginBottom: 16 }}>
          <div className="metric">
            <div className="value">
              {game.correct}/{game.answered}
            </div>
            <div className="label">bonnes reponses ({pct} %)</div>
          </div>
          <div className="metric">
            <div className="value">{game.bestStreak}</div>
            <div className="label">meilleure serie</div>
          </div>
        </div>

        {rates.length > 0 && (
          <>
            <h2>A revoir</h2>
            <div className="callout-list" style={{ marginBottom: 16 }}>
              {rates.map((i) => (
                <div key={itemKey(i)} className="callout-item">
                  <span>{i.callout.name}</span>
                  {multi && <small>{mapOf(i.mapId)?.name}</small>}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="row">
          <button className="btn" onClick={() => start(null)}>
            Rejouer
          </button>
          {rates.length > 0 && (
            <button className="btn-ghost" onClick={() => start(new Set(rates.map(itemKey)))}>
              Reviser les erreurs
            </button>
          )}
          <button className="btn-ghost" onClick={quit}>
            Changer de mode
          </button>
          <button className="btn-ghost" onClick={onBack}>
            Terminer
          </button>
        </div>
      </div>
    );
  }

  if (!question) return null;

  // ---------- Question ----------

  const map = mapOf(question.item.mapId);
  const target = map?.callouts.find((c) => c.id === question.item.callout.id);
  if (!map || !target) {
    // Carte ou endroit supprime entre-temps.
    return (
      <div className="card empty">
        <button className="btn" onClick={next}>
          Question suivante
        </button>
      </div>
    );
  }

  const markers: Array<{ callout: Callout; tone: MarkerTone; label?: boolean }> = [];
  if (question.mode === 'trouver') {
    for (const c of map.callouts) {
      if (answer && c.id === target.id) markers.push({ callout: c, tone: 'ok', label: true });
      else if (answer && c.id === answer.tap?.calloutId)
        markers.push({ callout: c, tone: 'bad', label: true });
      else if (showMarkers) markers.push({ callout: c, tone: 'neutral' });
    }
  } else {
    markers.push({
      callout: target,
      tone: answer ? (answer.correct ? 'ok' : 'bad') : 'target',
      label: !!answer,
    });
  }

  return (
    <>
      <div className="game-hud">
        <button className="btn-ghost" onClick={quit} aria-label="Quitter la partie">
          ✕
        </button>
        <span className="game-lives" aria-label={`${game.lives} vies`}>
          {Array.from({ length: START_LIVES }, (_, i) => (
            <i key={i} className={i < game.lives ? 'on' : ''}>
              ♥
            </i>
          ))}
        </span>
        <div className="spacer" />
        {game.streak >= 2 && <span className="game-streak">série ×{game.streak}</span>}
        <span className="game-score">{game.score}</span>
        <span className="tag">
          {effectiveLength === null
            ? `#${game.answered + (answer ? 0 : 1)}`
            : `${Math.min(game.answered + (answer ? 0 : 1), effectiveLength)}/${effectiveLength}`}
        </span>
      </div>

      <div className="quiz-prompt">
        {multi && <small className="game-map">{map.name}</small>}
        {question.mode === 'trouver' ? (
          <>
            <span>Ou est</span>
            <strong>{target.name}</strong>
          </>
        ) : (
          <span>Quel est le call de cet endroit ?</span>
        )}
        {!answer && <small className="hint" style={{ margin: 0 }}>+{pointsFor(game.streak)} pts</small>}
      </div>

      <CalloutBoard
        key={map.id}
        map={map}
        markers={markers}
        onTap={question.mode === 'trouver' && !answer ? onTap : undefined}
        overlay={
          answer?.tap && !answer.correct ? (
            <i
              className="cmap-tap"
              style={{ left: `${answer.tap.x * 100}%`, top: `${answer.tap.y * 100}%` }}
            />
          ) : null
        }
      />

      {question.mode === 'nommer' && (
        <div className="quiz-choices">
          {question.choices.map((name) => {
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
              ? `Exact ! +${answer.points}`
              : question.mode === 'trouver'
                ? `Non : vous avez touche ${map.callouts.find((c) => c.id === answer.tap?.calloutId)?.name ?? '?'}. −1 vie`
                : `Non : c'est ${target.name}. −1 vie`}
          </span>
          {!answer.correct && (
            <button className="btn" onClick={next}>
              {game.over ? 'Resultat' : 'Suivant'}
            </button>
          )}
        </div>
      )}
    </>
  );
}
