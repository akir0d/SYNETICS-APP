import { useEffect, useRef, useState } from 'react';
import type { CalloutMap } from '../../core/callouts/quiz';
import {
  MIN_CALLOUTS,
  exportCalloutMap,
  importCalloutMap,
  isMastered,
  newId,
} from '../../core/callouts/quiz';
import { deleteCalloutMap, listCalloutMaps, saveCalloutMap } from '../../core/storage/db';
import { saveTextFile } from '../../platform';
import { CalloutEditor } from '../components/CalloutEditor';
import { CalloutQuiz } from '../components/CalloutQuiz';

interface CalloutsScreenProps {
  /** Noms des arenes deja connues, proposes pour nommer un plan. */
  mapNames: readonly string[];
}

type Mode = { kind: 'list' } | { kind: 'edit'; id: string } | { kind: 'quiz'; id: string };

/** Plus grand cote conserve pour l'image d'un plan. */
const MAX_IMAGE_SIDE = 1600;

/**
 * Reduit l'image importee : une capture de telephone pese plusieurs Mo, et
 * le plan est stocke en entier dans la carte pour rester partageable.
 */
async function loadImage(file: File): Promise<{ image: string; aspect: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Image illisible."));
      img.src = url;
    });
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponible.');
    // Fond sombre : un plan PNG transparent deviendrait noir en JPEG.
    ctx.fillStyle = '#0a0e17';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { image: canvas.toDataURL('image/jpeg', 0.85), aspect: w / h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

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
 * Entrainement aux callouts : la liste des plans annotes, leur edition et le
 * quiz. L'ecran gere lui-meme sa persistance, independante des analyses.
 */
export function CalloutsScreen({ mapNames }: CalloutsScreenProps) {
  const [maps, setMaps] = useState<CalloutMap[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listCalloutMaps()
      .then(setMaps)
      .catch(() => setMessage({ ok: false, text: 'Stockage local inaccessible.' }));
  }, []);

  const persist = (map: CalloutMap) => {
    setMaps((prev) => {
      const others = prev.filter((m) => m.id !== map.id);
      return [...others, map].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    });
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
      setMessage({ ok: true, text: `« ${map.name} » importee : ${map.callouts.length} endroits.` });
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

  const active = mode.kind !== 'list' ? maps.find((m) => m.id === mode.id) : undefined;

  if (mode.kind === 'edit' && active) {
    return (
      <CalloutEditor
        map={active}
        mapNames={mapNames}
        onChange={persist}
        onTrain={() => setMode({ kind: 'quiz', id: active.id })}
        onBack={() => setMode({ kind: 'list' })}
      />
    );
  }

  if (mode.kind === 'quiz' && active) {
    return <CalloutQuiz map={active} onChange={persist} onBack={() => setMode({ kind: 'list' })} />;
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 6 }}>
        <h1 style={{ margin: 0 }}>Callouts</h1>
        <div className="spacer" />
        <button className="btn-ghost" onClick={() => jsonInput.current?.click()}>
          Importer
        </button>
        <button className="btn" onClick={() => imageInput.current?.click()}>
          Nouvelle carte
        </button>
      </div>
      <p className="hint">
        Apprenez les noms des endroits de chaque carte. Chargez un plan (capture, schema de
        l'equipe), posez-y les noms, puis entrainez-vous. Exportez une carte pour la partager avec
        vos coequipiers.
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
                <h3>{m.name || '(sans nom)'}</h3>
                <div className="sub">
                  {m.callouts.length} endroit{m.callouts.length > 1 ? 's' : ''} · {acquis} acquis
                </div>
                <div className="progress">
                  <div style={{ width: `${pct}%` }} />
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button
                    className="btn"
                    disabled={m.callouts.length < MIN_CALLOUTS}
                    title={m.callouts.length < MIN_CALLOUTS ? 'Posez au moins deux endroits' : ''}
                    onClick={() => setMode({ kind: 'quiz', id: m.id })}
                  >
                    S'entrainer
                  </button>
                  <button className="btn-ghost" onClick={() => setMode({ kind: 'edit', id: m.id })}>
                    Modifier
                  </button>
                  <div className="spacer" />
                  <button className="btn-ghost" onClick={() => void exportMap(m)} title="Exporter">
                    ⇪
                  </button>
                  <button className="btn-ghost btn-danger" onClick={() => remove(m)} title="Supprimer">
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
