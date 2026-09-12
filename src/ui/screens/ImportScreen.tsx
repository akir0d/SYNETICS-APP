import { useRef, useState } from 'react';
import type { AppSettings, GameProfileId, KnownMap } from '../../core/types';
import { GAME_PROFILES } from '../../core/types';
import { formatDuration } from '../../core/analysis/metrics';
import { analyzeVideoFile, type PipelineProgress, type PipelineResult } from '../../core/pipeline';
import { AnalysisAbortedError } from '../../core/video/sampler';
import { keepScreenAwake } from '../../platform';

const STAGE_LABEL: Record<PipelineProgress['stage'], string> = {
  chargement: 'Chargement de la video',
  echantillonnage: 'Lecture du signal video',
  decoupage: 'Decoupage de la rediffusion',
  analyse: 'Detection des phases de jeu',
  carte: 'Identification de l arene',
  'images-cles': 'Extraction des images cles',
  termine: 'Termine',
};

interface ImportScreenProps {
  settings: AppSettings;
  mapLibrary: readonly KnownMap[];
  onComplete: (result: PipelineResult) => void;
}

export function ImportScreen({ settings, mapLibrary, onComplete }: ImportScreenProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [profile, setProfile] = useState<GameProfileId>(settings.defaultProfile);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const busy = progress !== null && progress.stage !== 'termine';

  const pick = (selected: File | null | undefined) => {
    if (!selected) return;
    if (!selected.type.startsWith('video/')) {
      setError('Ce fichier ne semble pas etre une video.');
      return;
    }
    setError(null);
    setFile(selected);
  };

  const start = async () => {
    if (!file) return;
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const releaseScreen = await keepScreenAwake();
    try {
      const result = await analyzeVideoFile({
        file,
        profile,
        settings,
        mapLibrary,
        title,
        onProgress: setProgress,
        signal: controller.signal,
      });
      onComplete(result);
      setFile(null);
      setTitle('');
    } catch (e) {
      if (e instanceof AnalysisAbortedError) setError('Analyse annulee.');
      else setError(e instanceof Error ? e.message : "Echec de l'analyse.");
    } finally {
      releaseScreen();
      setProgress(null);
      abortRef.current = null;
    }
  };

  return (
    <>
      <h1>Nouvelle analyse</h1>
      <p className="hint">
        Chargez l'enregistrement d'un match EVA. La video est decodee sur l'appareil : elle n'est
        jamais televersee. Seules quelques images cles partent vers l'IA, et uniquement si vous
        lancez l'analyse IA.
      </p>

      {error && <div className="banner banner-error">{error}</div>}

      <div className="card">
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => pick(e.target.files?.[0])}
        />

        <div
          className={`dropzone${dragOver ? ' is-over' : ''}`}
          onClick={() => !busy && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (!busy) pick(e.dataTransfer.files?.[0]);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter') inputRef.current?.click();
          }}
        >
          <strong>{file ? file.name : 'Choisir une video de match'}</strong>
          <span>
            {file
              ? `${(file.size / 1024 / 1024).toFixed(1)} Mo — cliquez pour changer`
              : 'Glissez le fichier ici, ou cliquez pour parcourir (MP4 / H.264 recommande)'}
          </span>
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="field">
            <label htmlFor="title">Titre du match</label>
            <input
              id="title"
              type="text"
              value={title}
              placeholder="Laisser vide pour reprendre le nom du fichier"
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="field">
            <label htmlFor="profile">Mode de jeu</label>
            <select
              id="profile"
              value={profile}
              onChange={(e) => setProfile(e.target.value as GameProfileId)}
              disabled={busy}
            >
              {Object.values(GAME_PROFILES).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p className="hint" style={{ margin: 0 }}>
              {GAME_PROFILES[profile].description}
            </p>
          </div>
        </div>

        {progress && (
          <div style={{ marginTop: 8, marginBottom: 16 }}>
            <div className="row" style={{ marginBottom: 6, fontSize: 13 }}>
              <span>{STAGE_LABEL[progress.stage]}</span>
              <div className="spacer" />
              <span className="tag">{progress.message}</span>
            </div>
            <div className="progress">
              <div style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
            </div>
          </div>
        )}

        {settings.autoSegment && (
          <div className="banner banner-info">
            Decoupage automatique actif : une rediffusion de plusieurs heures est separee en
            matchs distincts (pause d'au moins {settings.minGapS} s, match d'au moins{' '}
            {formatDuration(settings.minMatchS)}). Chaque match devient une analyse autonome.
          </div>
        )}

        <div className="row">
          <button className="btn" onClick={start} disabled={!file || busy}>
            {busy ? 'Analyse en cours...' : "Lancer l'analyse locale"}
          </button>
          {busy && (
            <button className="btn-ghost" onClick={() => abortRef.current?.abort()}>
              Annuler
            </button>
          )}
          <div className="spacer" />
          <span className="hint" style={{ margin: 0 }}>
            {settings.samplingHz} image/s analysee · {settings.aiFrameBudget} images cles pour l'IA
          </span>
        </div>
      </div>

      <div className="card">
        <h2>Comment enregistrer votre match</h2>
        <ul className="ai-list">
          <li>
            Le plus simple : filmez l'ecran de retransmission de l'arene, ou recuperez la capture
            de votre session si votre salle la propose.
          </li>
          <li>
            Cadrez large et stable : le moteur local lit le mouvement et les flashs a l'image, une
            camera qui bouge sans arret degrade la detection.
          </li>
          <li>
            Pas besoin de decouper vous-meme : chargez la rediffusion entiere, l'application
            separe les manches et analyse chacune a part. Le decoupage se regle dans les
            Reglages, ou se desactive si votre fichier ne contient qu'un match.
          </li>
        </ul>
      </div>
    </>
  );
}
