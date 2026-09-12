import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings, MatchAnalysis } from './core/types';
import { DEFAULT_SETTINGS } from './core/types';
import { loadSettings, saveSettings } from './core/storage/settings';
import { deleteAnalysis, listAnalyses, saveAnalysis } from './core/storage/db';
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

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [analyses, setAnalyses] = useState<MatchAnalysis[]>([]);
  const [current, setCurrent] = useState<MatchAnalysis | null>(null);
  const [view, setView] = useState<View>('library');
  const [storageError, setStorageError] = useState<string | null>(null);

  // Ressources de session liees a la video en cours : volumineuses, donc
  // gardees hors du state React et liberees explicitement.
  const keyframesRef = useRef<readonly Keyframe[]>([]);
  const videoUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setSettings(loadSettings());
    listAnalyses()
      .then(setAnalyses)
      .catch(() => setStorageError("Stockage local inaccessible : les analyses ne seront pas conservees."));
  }, []);

  const updateSettings = useCallback((next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const persist = useCallback((analysis: MatchAnalysis) => {
    setCurrent(analysis);
    setAnalyses((prev) => {
      const rest = prev.filter((a) => a.id !== analysis.id);
      return [analysis, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
    saveAnalysis(analysis).catch(() =>
      setStorageError("Echec de l'enregistrement local de cette analyse."),
    );
  }, []);

  const releaseVideo = useCallback(() => {
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    videoUrlRef.current = null;
    keyframesRef.current = [];
  }, []);

  const onAnalysisComplete = useCallback(
    (result: PipelineResult) => {
      releaseVideo();
      keyframesRef.current = result.keyframes;
      videoUrlRef.current = result.objectUrl;
      persist(result.analysis);
      setView('report');
    },
    [persist, releaseVideo],
  );

  const openAnalysis = useCallback(
    (analysis: MatchAnalysis) => {
      // Une analyse rouverte n'a plus sa video : le rapport proposera de la rattacher.
      releaseVideo();
      setCurrent(analysis);
      setView('report');
    },
    [releaseVideo],
  );

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
          <LibraryScreen
            analyses={analyses}
            onOpen={openAnalysis}
            onDelete={removeAnalysis}
            onNew={() => setView('import')}
          />
        )}

        {view === 'import' && (
          <ImportScreen settings={settings} onComplete={onAnalysisComplete} />
        )}

        {view === 'report' && current && (
          <ReportScreen
            key={current.id}
            analysis={current}
            settings={settings}
            initialKeyframes={keyframesRef.current}
            initialVideoUrl={videoUrlRef.current}
            onChange={persist}
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

        {view === 'settings' && <SettingsScreen settings={settings} onChange={updateSettings} />}
      </main>
    </div>
  );
}
