import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings, KnownMap, MapFingerprint, MatchAnalysis } from './core/types';
import { DEFAULT_SETTINGS } from './core/types';
import { loadSettings, saveSettings } from './core/storage/settings';
import {
  deleteAnalysis,
  deleteMap,
  listAnalyses,
  listMaps,
  saveAnalyses,
  saveAnalysis,
  saveMap,
} from './core/storage/db';
import { mergeFingerprints } from './core/analysis/mapmatch';
import type { Keyframe } from './core/video/sampler';
import type { PipelineResult } from './core/pipeline';
import { LibraryScreen } from './ui/screens/LibraryScreen';
import { ImportScreen } from './ui/screens/ImportScreen';
import { ReportScreen } from './ui/screens/ReportScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';

type View = 'library' | 'import' | 'report' | 'settings';

const NAV: Array<{ id: View; label: string }> = [
  { id: 'library', label: 'Bibliotheque' },
  { id: 'import', label: 'Nouvelle analyse' },
  { id: 'settings', label: 'Reglages' },
];

/** Ressources volumineuses liees a la video en cours : hors du state React. */
interface Session {
  sessionId: string;
  objectUrl: string;
  keyframes: Map<string, Keyframe[]>;
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [analyses, setAnalyses] = useState<MatchAnalysis[]>([]);
  const [maps, setMaps] = useState<KnownMap[]>([]);
  const [current, setCurrent] = useState<MatchAnalysis | null>(null);
  const [view, setView] = useState<View>('library');
  const [storageError, setStorageError] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  const sessionRef = useRef<Session | null>(null);

  useEffect(() => {
    setSettings(loadSettings());
    listAnalyses()
      .then(setAnalyses)
      .catch(() =>
        setStorageError("Stockage local inaccessible : les analyses ne seront pas conservees."),
      );
    listMaps().then(setMaps).catch(() => setMaps([]));
  }, []);

  const updateSettings = useCallback((next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const mergeIntoList = useCallback((incoming: readonly MatchAnalysis[]) => {
    setAnalyses((prev) => {
      const ids = new Set(incoming.map((a) => a.id));
      return [...incoming, ...prev.filter((a) => !ids.has(a.id))].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
    });
  }, []);

  const persist = useCallback(
    (analysis: MatchAnalysis) => {
      setCurrent(analysis);
      mergeIntoList([analysis]);
      saveAnalysis(analysis).catch(() =>
        setStorageError("Echec de l'enregistrement local de cette analyse."),
      );
    },
    [mergeIntoList],
  );

  const releaseSession = useCallback(() => {
    if (sessionRef.current) URL.revokeObjectURL(sessionRef.current.objectUrl);
    sessionRef.current = null;
  }, []);

  const onAnalysisComplete = useCallback(
    (result: PipelineResult) => {
      releaseSession();
      sessionRef.current = {
        sessionId: result.sessionId,
        objectUrl: result.objectUrl,
        keyframes: result.keyframes,
      };

      mergeIntoList(result.analyses);
      saveAnalyses(result.analyses).catch(() =>
        setStorageError("Echec de l'enregistrement local des analyses."),
      );

      const first = result.analyses[0] ?? null;
      if (result.analyses.length > 1) {
        setSessionNotice(
          `${result.analyses.length} matchs detectes dans cette rediffusion. Ouvrez-les depuis la bibliotheque : la video reste rattachee tant que vous ne quittez pas l'application.`,
        );
        setCurrent(first);
        setView('library');
      } else {
        setSessionNotice(null);
        setCurrent(first);
        setView('report');
      }
    },
    [mergeIntoList, releaseSession],
  );

  const openAnalysis = useCallback((analysis: MatchAnalysis) => {
    setCurrent(analysis);
    setView('report');
  }, []);

  const removeAnalysis = useCallback(
    (analysis: MatchAnalysis) => {
      if (!window.confirm(`Supprimer definitivement « ${analysis.title} » ?`)) return;
      setAnalyses((prev) => prev.filter((a) => a.id !== analysis.id));
      if (current?.id === analysis.id) {
        setCurrent(null);
        setView('library');
      }
      deleteAnalysis(analysis.id).catch(() => setStorageError('Suppression impossible.'));
    },
    [current],
  );

  /**
   * Le joueur nomme l'arene d'un match. C'est le seul moment ou la
   * bibliotheque de cartes apprend : la reconnaissance automatique des matchs
   * suivants decoule entierement de ces confirmations.
   */
  const confirmMap = useCallback(
    async (analysis: MatchAnalysis, name: string, existingId: string | null) => {
      const trimmed = name.trim();
      if (!trimmed) return;

      const fingerprint: MapFingerprint | undefined = analysis.mapFingerprint;
      const now = new Date().toISOString();
      let target = existingId ? maps.find((m) => m.id === existingId) : undefined;
      if (!target) target = maps.find((m) => m.name.toLowerCase() === trimmed.toLowerCase());

      let saved: KnownMap;
      if (target && fingerprint) {
        saved = {
          ...target,
          name: trimmed,
          fingerprint: mergeFingerprints(target.fingerprint, fingerprint, target.matchCount),
          matchCount: target.matchCount + 1,
          updatedAt: now,
        };
      } else if (target) {
        saved = { ...target, name: trimmed, updatedAt: now };
      } else if (fingerprint) {
        saved = {
          id: `map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          name: trimmed,
          fingerprint,
          matchCount: 1,
          createdAt: now,
          updatedAt: now,
        };
      } else {
        // Sans signature (analyse importee d'une version anterieure), on garde
        // le nom sur le match sans polluer la bibliotheque d'arenes.
        persist({
          ...analysis,
          map: { ...analysis.map, mapName: trimmed, confirmed: true, confidence: 1 },
        });
        return;
      }

      setMaps((prev) => [...prev.filter((m) => m.id !== saved.id), saved].sort((a, b) =>
        a.name.localeCompare(b.name, 'fr'),
      ));
      await saveMap(saved).catch(() => setStorageError("Echec de l'enregistrement de l'arene."));

      persist({
        ...analysis,
        map: {
          mapId: saved.id,
          mapName: saved.name,
          confidence: 1,
          confirmed: true,
          distance: analysis.map.distance,
        },
      });
    },
    [maps, persist],
  );

  const removeMap = useCallback((id: string) => {
    setMaps((prev) => prev.filter((m) => m.id !== id));
    deleteMap(id).catch(() => setStorageError("Suppression de l'arene impossible."));
  }, []);

  const session = sessionRef.current;
  const sessionKeyframes = current ? session?.keyframes.get(current.id) ?? [] : [];
  const sessionVideoUrl =
    current && session?.keyframes.has(current.id) ? session.objectUrl : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>SYNETICS</strong>
          <span>Analyse IA de matchs EVA</span>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              aria-current={view === item.id || (view === 'report' && item.id === 'library')}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="main">
        {storageError && <div className="banner banner-error">{storageError}</div>}

        {view === 'library' && (
          <>
            {sessionNotice && (
              <div className="banner banner-ok" role="status">
                {sessionNotice}
              </div>
            )}
            <LibraryScreen
              analyses={analyses}
              onOpen={openAnalysis}
              onDelete={removeAnalysis}
              onNew={() => setView('import')}
            />
          </>
        )}

        {view === 'import' && (
          <ImportScreen settings={settings} mapLibrary={maps} onComplete={onAnalysisComplete} />
        )}

        {view === 'report' && current && (
          <ReportScreen
            key={current.id}
            analysis={current}
            settings={settings}
            mapLibrary={maps}
            initialKeyframes={sessionKeyframes}
            initialVideoUrl={sessionVideoUrl}
            onChange={persist}
            onConfirmMap={confirmMap}
            onBack={() => setView('library')}
          />
        )}

        {view === 'report' && !current && (
          <div className="card empty">
            <p>Aucune analyse ouverte.</p>
            <button className="btn" onClick={() => setView('library')}>
              Revenir a la bibliotheque
            </button>
          </div>
        )}

        {view === 'settings' && (
          <SettingsScreen
            settings={settings}
            maps={maps}
            onChange={updateSettings}
            onDeleteMap={removeMap}
          />
        )}
      </main>
    </div>
  );
}
