import { useEffect, useRef, useState } from 'react';
import type { CalloutMap } from '../../core/callouts/quiz';
import { EMPTY_STATS, MIN_CALLOUTS, newId } from '../../core/callouts/quiz';
import { CalloutBoard } from './CalloutBoard';

interface CalloutEditorProps {
  map: CalloutMap;
  /** Noms des arenes deja connues, proposes pour nommer le plan. */
  mapNames: readonly string[];
  onChange: (map: CalloutMap) => void;
  onTrain: () => void;
  onBack: () => void;
}

/**
 * Pose des noms sur le plan. Chaque modification est enregistree aussitot :
 * on annote souvent un plan par petites touches, entre deux parties.
 */
export function CalloutEditor({ map, mapNames, onChange, onTrain, onBack }: CalloutEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const selected = map.callouts.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !moving) nameRef.current?.select();
  }, [selectedId, moving]);

  const update = (patch: Partial<CalloutMap>) =>
    onChange({ ...map, ...patch, updatedAt: new Date().toISOString() });

  const onTap = (x: number, y: number) => {
    if (moving && selected) {
      update({ callouts: map.callouts.map((c) => (c.id === selected.id ? { ...c, x, y } : c)) });
      setMoving(false);
      return;
    }
    const callout = {
      id: newId('call'),
      name: `Endroit ${map.callouts.length + 1}`,
      x,
      y,
      stats: { ...EMPTY_STATS },
    };
    update({ callouts: [...map.callouts, callout] });
    setSelectedId(callout.id);
  };

  const rename = (name: string) => {
    if (!selected) return;
    update({ callouts: map.callouts.map((c) => (c.id === selected.id ? { ...c, name } : c)) });
  };

  const remove = () => {
    if (!selected) return;
    update({ callouts: map.callouts.filter((c) => c.id !== selected.id) });
    setSelectedId(null);
    setMoving(false);
  };

  const sorted = [...map.callouts].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const doublons = new Set(
    map.callouts
      .map((c) => c.name.trim().toLowerCase())
      .filter((n, i, all) => n && all.indexOf(n) !== i),
  );

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn-ghost" onClick={onBack}>
          ← Cartes
        </button>
        <div className="spacer" />
        <button className="btn" onClick={onTrain} disabled={map.callouts.length < MIN_CALLOUTS}>
          S'entrainer
        </button>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="field">
            <label htmlFor="callmap-name">Nom de la carte</label>
            <input
              id="callmap-name"
              type="text"
              list="callmap-known"
              value={map.name}
              onChange={(e) => update({ name: e.target.value })}
            />
            <datalist id="callmap-known">
              {mapNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
          <p className="hint">
            {moving
              ? `Touchez le nouvel emplacement de « ${selected?.name} ».`
              : 'Touchez le plan pour poser un endroit, touchez un repere pour le modifier.'}
          </p>
          <CalloutBoard
            map={map}
            markers={map.callouts.map((c) => ({
              callout: c,
              tone: c.id === selectedId ? 'selected' : 'neutral',
              label: true,
            }))}
            onTap={onTap}
            onMarkerTap={(c) => {
              setSelectedId(c.id);
              setMoving(false);
            }}
          />
        </div>

        <div className="card">
          {selected ? (
            <>
              <h2>Endroit</h2>
              <div className="field">
                <label htmlFor="callout-name">Nom annonce en partie</label>
                <input
                  id="callout-name"
                  ref={nameRef}
                  type="text"
                  value={selected.name}
                  onChange={(e) => rename(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && setSelectedId(null)}
                />
              </div>
              {doublons.has(selected.name.trim().toLowerCase()) && (
                <div className="banner banner-info">
                  Un autre endroit porte deja ce nom : le quiz ne pourra pas les distinguer.
                </div>
              )}
              <div className="row">
                <button className="btn-ghost" onClick={() => setMoving((m) => !m)}>
                  {moving ? 'Annuler le deplacement' : 'Deplacer'}
                </button>
                <button className="btn-ghost btn-danger" onClick={remove}>
                  Supprimer
                </button>
                <div className="spacer" />
                <button className="btn-ghost" onClick={() => setSelectedId(null)}>
                  OK
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>
                {map.callouts.length} endroit{map.callouts.length > 1 ? 's' : ''}
              </h2>
              {sorted.length === 0 ? (
                <p className="hint">Aucun endroit pose pour l'instant.</p>
              ) : (
                <div className="callout-list">
                  {sorted.map((c) => (
                    <button key={c.id} className="callout-item" onClick={() => setSelectedId(c.id)}>
                      <span>{c.name || '(sans nom)'}</span>
                      {c.stats.seen > 0 && (
                        <small>
                          {c.stats.correct}/{c.stats.seen}
                        </small>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
