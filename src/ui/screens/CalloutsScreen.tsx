import { useEffect, useRef, useState } from 'react';
import type { CalloutMap } from '../../core/callouts/quiz';
import {
  MIN_CALLOUTS,
  exportCalloutMap,
  importCalloutMap,
  isMastered,
  newId,
} from '../../core/callouts/quiz';
import { START_LIVES, buildPool } from '../../core/callouts/game';
import { BUILTIN_MAPS, syncBuiltin } from '../../core/callouts/catalog';
import { deleteCalloutMap, listCalloutMaps, saveCalloutMap } from '../../core/storage/db';
import { saveTextFile } from '../../platform';
import { CalloutBoard } from '../components/CalloutBoard';
import { CalloutEditor } from '../components/CalloutEditor';
import { CalloutGame } from '../components/CalloutGame';
import { loadImage } from '../loadImage';

interface CalloutsScreenProps {
  /** Noms des arenes deja connues, proposes pour nommer un plan. */
  mapNames: readonly string[];
}

/** Perimetre d'une partie : une carte, ou toutes. */
const ALL = 'all';

type Mode =
  | { kind: 'list' }
  | { kind: 'edit'; id: string }
  | { kind: 'review'; id: string }
  | { kind: 'play'; scope: string };

function slug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'carte'
  );
}

/**
 * Revision d'une carte : le plan annote quand il existe, sinon le plan nu
 * avec tous les noms affiches.
 */
function CalloutReview({ map, onPlay, onBack }: { map: CalloutMap; onPlay: () => void; onBack: () => void }) {
  const [annotated, setAnnotated] = useState(!!map.reference);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn-ghost" onClick={onBack}>
          ← Cartes
        </button>
        <div className="spacer" />
        <button className="btn" onClick={onPlay} disabled={map.callouts.length < MIN_CALLOUTS}>
          Jouer
        </button>
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <h1 style={{ margin: 0 }}>{map.name}</h1>
          <div className="spacer" />
          {map.reference && (
            <button className="btn-ghost" onClick={() => setAnnotated((a) => !a)}>
              {annotated ? 'Voir les reperes' : 'Voir le plan annote'}
            </button>
          )}
        </div>
        {!(annotated && map.reference) && (
          <p className="hint">En vert, les calls acquis (trois bonnes reponses d'affilee).</p>
        )}
        {annotated && map.reference ? (
          <CalloutBoard map={{ ...map, image: map.reference }} markers={[]} />
        ) : (
          <CalloutBoard
            map={map}
            markers={map.callouts.map((c) => ({
              callout: c,
              tone: isMastered(c.stats) ? 'mastered' : 'neutral',
              label: true,
            }))}
          />
        )}
      </div>
    </>
  );
}

/**
 * Entrainement aux callouts : la liste des cartes, leur edition, leur
 * revision et le trainer. L'ecran gere lui-meme sa persistance, independante
 * des analyses.
 */
export function CalloutsScreen({ mapNames }: CalloutsScreenProps) {
  const [maps, setMaps] = useState<CalloutMap[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listCalloutMaps()
      .then(async (stored) => {
        // Les cartes livrees avec l'application sont installees ou mises a
        // jour ici, sans toucher a la progression du joueur.
        const updates = syncBuiltin(stored, BUILTIN_MAPS, new Date().toISOString());
        await Promise.all(updates.map(saveCalloutMap));
        const ids = new Set(updates.map((m) => m.id));
        setMaps(sortMaps([...stored.filter((m) => !ids.has(m.id)), ...updates]));
      })
      .catch(() => setMessage({ ok: false, text: 'Stockage local inaccessible.' }));
  }, []);

  const persist = (map: CalloutMap) => {
    setMaps((prev) => sortMaps([...prev.filter((m) => m.id !== map.id), map]));
    saveCalloutMap(map).catch(() =>
      setMessage({ ok: false, text: "Echec de l'enregistrement de la carte." }),
    );
  };

  const createFromImage = async (file: File) => {
    try {
      const { image, aspect } = await loadImage(file);
      const now = new Date().toISOString();
      const map: CalloutMap = {
        id: newId('callmap'),
        name: file.name.replace(/\.[^.]+$/, '') || 'Nouvelle carte',
        image,
        aspect,
        callouts: [],
        createdAt: now,
        updatedAt: now,
      };
      persist(map);
      setMessage(null);
      setMode({ kind: 'edit', id: map.id });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Import impossible.' });
    }
  };

  const importFile = async (file: File) => {
    try {
      const map = importCalloutMap(await file.text(), new Date().toISOString());
      persist(map);
      setMessage({ ok: true, text: `« ${map.name} » importee : ${map.callouts.length} calls.` });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Import impossible.' });
    }
  };

  const exportMap = async (map: CalloutMap) => {
    try {
      const r = await saveTextFile(
        `callouts-${slug(map.name)}.json`,
        exportCalloutMap(map),
        'application/json',
      );
      setMessage({ ok: r.ok, text: r.message });
    } catch {
      setMessage({ ok: false, text: 'Export impossible.' });
    }
  };

  const remove = (map: CalloutMap) => {
    if (!window.confirm(`Supprimer definitivement la carte « ${map.name} » ?`)) return;
    setMaps((prev) => prev.filter((m) => m.id !== map.id));
    deleteCalloutMap(map.id).catch(() => setMessage({ ok: false, text: 'Suppression impossible.' }));
  };

  if (mode.kind === 'play') {
    const scoped = mode.scope === ALL ? maps : maps.filter((m) => m.id === mode.scope);
    if (scoped.length > 0) {
      return (
        <CalloutGame
          key={mode.scope}
          maps={scoped}
          scope={mode.scope}
          title={mode.scope === ALL ? 'Toutes les cartes' : scoped[0]?.name ?? ''}
          onChange={persist}
          onBack={() => setMode({ kind: 'list' })}
        />
      );
    }
  }

  const active = mode.kind === 'edit' || mode.kind === 'review' ? maps.find((m) => m.id === mode.id) : undefined;

  if (mode.kind === 'edit' && active) {
    return (
      <CalloutEditor
        map={active}
        mapNames={mapNames}
        onChange={persist}
        onTrain={() => setMode({ kind: 'play', scope: active.id })}
        onBack={() => setMode({ kind: 'list' })}
      />
    );
  }

  if (mode.kind === 'review' && active) {
    return (
      <CalloutReview
        map={active}
        onPlay={() => setMode({ kind: 'play', scope: active.id })}
        onBack={() => setMode({ kind: 'list' })}
      />
    );
  }

  const totalCalls = buildPool(maps).length;
  const jouables = maps.filter((m) => m.callouts.length >= MIN_CALLOUTS);

  return (
    <>
      <div className="row" style={{ marginBottom: 6 }}>
        <h1 style={{ margin: 0 }}>Callouts</h1>
        <div className="spacer" />
        <button className="btn-ghost" onClick={() => jsonInput.current?.click()}>
          Importer
        </button>
        <button className="btn-ghost" onClick={() => imageInput.current?.click()}>
          Nouvelle carte
        </button>
      </div>
      <p className="hint">
        Apprenez les calls de chaque carte : 20 questions ou mode infini, avec {START_LIVES} vies. Jouez carte
        par carte ou toutes melangees.
      </p>

      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void createFromImage(f);
        }}
      />
      <input
        ref={jsonInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importFile(f);
        }}
      />

      {message && (
        <div className={`banner ${message.ok ? 'banner-ok' : 'banner-error'}`} role="status">
          {message.text}
        </div>
      )}

      {jouables.length > 1 && (
        <div className="card game-all">
          <div>
            <h3 style={{ margin: 0 }}>Toutes les cartes</h3>
            <div className="sub">
              {totalCalls} calls sur {maps.length} cartes, melanges
            </div>
          </div>
          <button className="btn" onClick={() => setMode({ kind: 'play', scope: ALL })}>
            Jouer
          </button>
        </div>
      )}

      {maps.length === 0 ? (
        <div className="card empty">
          <p>Aucune carte pour l'instant.</p>
          <button className="btn" onClick={() => imageInput.current?.click()}>
            Charger un plan
          </button>
        </div>
      ) : (
        <div className="library">
          {maps.map((m) => {
            const acquis = m.callouts.filter((c) => isMastered(c.stats)).length;
            const pct = m.callouts.length ? Math.round((acquis / m.callouts.length) * 100) : 0;
            return (
              <div className="match-card" key={m.id}>
                <img className="callmap-thumb" src={m.image} alt="" />
                <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                  <h3 style={{ flex: 1, minWidth: 0 }}>{m.name || '(sans nom)'}</h3>
                  {!m.builtin && (
                    <>
                      <button className="btn-icon" onClick={() => void exportMap(m)} title="Exporter" aria-label="Exporter">
                        ⇪
                      </button>
                      <button className="btn-icon btn-danger" onClick={() => remove(m)} title="Supprimer" aria-label="Supprimer">
                        ✕
                      </button>
                    </>
                  )}
                </div>
                <div className="sub">
                  {m.callouts.length} call{m.callouts.length > 1 ? 's' : ''} · {acquis} acquis
                  {m.builtin ? ' · officielle' : ''}
                </div>
                <div className="progress">
                  <div style={{ width: `${pct}%` }} />
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button
                    className="btn"
                    disabled={m.callouts.length < MIN_CALLOUTS}
                    title={m.callouts.length < MIN_CALLOUTS ? 'Posez au moins deux calls' : ''}
                    onClick={() => setMode({ kind: 'play', scope: m.id })}
                  >
                    Jouer
                  </button>
                  <button className="btn-ghost" onClick={() => setMode({ kind: 'review', id: m.id })}>
                    Reviser
                  </button>
                  {!m.builtin && (
                    <button className="btn-ghost" onClick={() => setMode({ kind: 'edit', id: m.id })}>
                      Modifier
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Cartes officielles d'abord, puis celles du joueur, chacune par nom. */
function sortMaps(maps: CalloutMap[]): CalloutMap[] {
  return maps.sort(
    (a, b) => Number(!!b.builtin) - Number(!!a.builtin) || a.name.localeCompare(b.name, 'fr'),
  );
}
