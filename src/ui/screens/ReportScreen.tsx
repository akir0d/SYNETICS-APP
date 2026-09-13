import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppSettings,
  EventType,
  KnownMap,
  MatchAnalysis,
  MatchEvent,
  MatchOutcome,
} from '../../core/types';
import { EVENT_TYPES, GAME_PROFILES, OUTCOME_LABELS } from '../../core/types';
import { computeIntensity, runLocalAnalysis } from '../../core/analysis/heuristics';
import { formatDuration } from '../../core/analysis/metrics';
import { recomputeAnalysis } from '../../core/pipeline';
import { extractKeyframes, loadVideo, type Keyframe } from '../../core/video/sampler';
import { selectKeyframeTimes } from '../../core/analysis/heuristics';
import { aiReportToEvents, analyzeMatchWithClaude, describeAiError } from '../../core/ai/claude';
import { eventsToCsv, slugify, toJson, toMarkdown } from '../../core/export';
import { saveTextFile } from '../../platform';
import { Timeline } from '../components/Timeline';
import { MetricGrid } from '../components/MetricGrid';
import { ScoreBars } from '../components/ScoreBars';
import { EventList } from '../components/EventList';
import { AiPanel } from '../components/AiPanel';
import { MapPanel } from '../components/MapPanel';

/** Types que le joueur peut poser a la main pendant la relecture. */
const MARKABLE: EventType[] = ['kill', 'death', 'damage_taken', 'objective', 'respawn', 'note'];

type SourceFilter = 'all' | 'manual' | 'ai' | 'local';

interface ReportScreenProps {
  analysis: MatchAnalysis;
  settings: AppSettings;
  mapLibrary: readonly KnownMap[];
  initialKeyframes: readonly Keyframe[];
  initialVideoUrl: string | null;
  onChange: (analysis: MatchAnalysis) => void;
  onConfirmMap: (analysis: MatchAnalysis, name: string, existingId: string | null) => void;
  onBack: () => void;
}

export function ReportScreen({
  analysis,
  settings,
  mapLibrary,
  initialKeyframes,
  initialVideoUrl,
  onChange,
  onConfirmMap,
  onBack,
}: ReportScreenProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const attachRef = useRef<HTMLInputElement | null>(null);
  const keyframesRef = useRef<readonly Keyframe[]>(initialKeyframes);

  const [videoUrl, setVideoUrl] = useState<string | null>(initialVideoUrl);
  const [ownedUrl, setOwnedUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Les URL d'objet creees ici doivent etre liberees : sur Android, laisser
  // filer un blob video de 500 Mo suffit a faire tuer l'application.
  useEffect(() => {
    return () => {
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    };
  }, [ownedUrl]);

  const local = useMemo(
    () => runLocalAnalysis(analysis.features, { samplingHz: analysis.settings.samplingHz }),
    [analysis.features, analysis.settings.samplingHz],
  );
  const intensity = useMemo(
    () => computeIntensity(analysis.features, analysis.settings.samplingHz),
    [analysis.features, analysis.settings.samplingHz],
  );

  // Les horodatages de l'analyse repartent de zero, mais le match peut se
  // trouver a la deux-heure-trente d'une rediffusion : la lecture ajoute donc
  // le decalage, et l'affichage le retire.
  const offsetS = analysis.sourceOffsetS ?? 0;

  const seek = useCallback(
    (t: number) => {
      const bounded = Math.min(analysis.video.durationS, Math.max(0, t));
      setCurrentTime(bounded);
      const video = videoRef.current;
      if (video) video.currentTime = offsetS + bounded;
    },
    [offsetS, analysis.video.durationS],
  );

  const addEvent = useCallback(
    (type: EventType) => {
      const event: MatchEvent = {
        id: `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        t: currentTime,
        type,
        source: 'manual',
        confidence: 1,
        label: EVENT_TYPES[type].label,
      };
      onChange(recomputeAnalysis(analysis, [...analysis.events, event]));
      setSelectedId(event.id);
      setToast(`${EVENT_TYPES[type].label} marque a ${formatDuration(currentTime)}`);
    },
    [analysis, currentTime, onChange],
  );

  const removeEvent = useCallback(
    (event: MatchEvent) => {
      onChange(recomputeAnalysis(analysis, analysis.events.filter((e) => e.id !== event.id)));
    },
    [analysis, onChange],
  );

  // Raccourcis clavier (PC) : marquer sans quitter la video des yeux.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (e.key === ' ') {
        e.preventDefault();
        const video = videoRef.current;
        if (video) video.paused ? void video.play() : video.pause();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seek(Math.max(0, currentTime - (e.shiftKey ? 1 : 5)));
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        seek(Math.min(analysis.video.durationS, currentTime + (e.shiftKey ? 1 : 5)));
        return;
      }
      const match = MARKABLE.find((type) => EVENT_TYPES[type].hotkey === e.key.toLowerCase());
      if (match) {
        e.preventDefault();
        addEvent(match);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addEvent, currentTime, seek, analysis.video.durationS]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const attachVideo = async (file: File | undefined) => {
    if (!file) return;
    try {
      const loaded = await loadVideo(file);
      if (Math.abs(loaded.meta.durationS - analysis.video.durationS) > 2) {
        setToast('Attention : cette video n a pas la meme duree que celle analysee.');
      }
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
      setOwnedUrl(loaded.objectUrl);
      setVideoUrl(loaded.objectUrl);
      // Les images cles de la session precedente ne valent plus rien.
      keyframesRef.current = [];
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Video illisible.');
    }
  };

  /**
   * Les images cles ne sont pas persistees (elles pesent trop lourd pour le
   * stockage local) : a la reouverture d'une analyse, on les reconstruit a la
   * volee depuis la video rattachee.
   */
  const ensureKeyframes = async (): Promise<readonly Keyframe[]> => {
    if (keyframesRef.current.length > 0) return keyframesRef.current;
    if (!videoUrl) {
      throw new Error("Rattachez la video du match pour relancer l'analyse IA.");
    }
    const offscreen = document.createElement('video');
    offscreen.preload = 'auto';
    offscreen.muted = true;
    offscreen.src = videoUrl;
    await new Promise<void>((resolve, reject) => {
      offscreen.addEventListener('loadedmetadata', () => resolve(), { once: true });
      offscreen.addEventListener('error', () => reject(new Error('Video illisible.')), {
        once: true,
      });
    });
    const times = selectKeyframeTimes(analysis.features, intensity, settings.aiFrameBudget);
    // On va chercher les images dans le fichier source, mais on les rend a
    // l'IA en temps de match, coherent avec le reste de l'analyse.
    const extracted = await extractKeyframes(
      offscreen,
      times.map((t) => t + offsetS),
    );
    const frames = extracted.map((frame, i) => ({ ...frame, t: times[i] ?? frame.t - offsetS }));
    keyframesRef.current = frames;
    return frames;
  };

  const runAi = async () => {
    setAiBusy(true);
    setAiError(null);
    try {
      const frames = await ensureKeyframes();
      const report = await analyzeMatchWithClaude({
        apiKey: settings.apiKey,
        model: settings.aiModel,
        frames,
        context: {
          profile: analysis.profile,
          metrics: analysis.metrics,
          playerName: settings.playerName,
          frameTimes: frames.map((f) => f.t),
          notes: analysis.notes,
          mapName: analysis.map.mapName,
          segment: { index: analysis.segmentIndex, count: analysis.segmentCount },
        },
      });
      // On remplace les evenements IA precedents : deux passes ne doivent pas
      // empiler deux timelines concurrentes sur la meme video.
      const withoutOldAi = analysis.events.filter((e) => e.source !== 'ai');
      onChange(recomputeAnalysis(analysis, [...withoutOldAi, ...aiReportToEvents(report)]));

      setToast('Analyse IA terminee.');
    } catch (e) {
      setAiError(describeAiError(e));
    } finally {
      setAiBusy(false);
    }
  };

  const exportAs = async (format: 'json' | 'csv' | 'md') => {
    const base = slugify(analysis.title);
    const map = {
      json: { name: `${base}.json`, content: toJson(analysis), mime: 'application/json' },
      csv: { name: `${base}-timeline.csv`, content: eventsToCsv(analysis), mime: 'text/csv' },
      md: { name: `${base}.md`, content: toMarkdown(analysis), mime: 'text/markdown' },
    }[format];
    try {
      const result = await saveTextFile(map.name, map.content, map.mime);
      setToast(result.message);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Echec de l'export.");
    }
  };

  const visibleEvents = useMemo(() => {
    const sorted = [...analysis.events].sort((a, b) => a.t - b.t);
    if (filter === 'all') return sorted;
    return sorted.filter((e) => e.source === filter);
  }, [analysis.events, filter]);

  const counts = useMemo(
    () => ({
      all: analysis.events.length,
      manual: analysis.events.filter((e) => e.source === 'manual').length,
      ai: analysis.events.filter((e) => e.source === 'ai').length,
      local: analysis.events.filter((e) => e.source === 'local').length,
    }),
    [analysis.events],
  );

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn-ghost" onClick={onBack}>
          ← Bibliotheque
        </button>
        <div className="spacer" />
        <button className="btn-ghost" onClick={() => void exportAs('md')}>
          Export Markdown
        </button>
        <button className="btn-ghost" onClick={() => void exportAs('csv')}>
          Export CSV
        </button>
        <button className="btn-ghost" onClick={() => void exportAs('json')}>
          Export JSON
        </button>
      </div>

      <input
        ref={attachRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => void attachVideo(e.target.files?.[0])}
      />

      {toast && <div className="banner banner-ok">{toast}</div>}

      <div className="card">
        <div className="field" style={{ marginBottom: 8 }}>
          <input
            type="text"
            value={analysis.title}
            aria-label="Titre du match"
            onChange={(e) => onChange({ ...analysis, title: e.target.value })}
            style={{ fontSize: 19, fontWeight: 600 }}
          />
        </div>
        <div className="row" style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>Issue de la manche :</span>
          {(['victoire', 'defaite', 'egalite', 'inconnue'] as MatchOutcome[]).map((value) => (
            <button
              key={value}
              className="btn-ghost"
              style={{
                padding: '4px 12px',
                ...(analysis.outcome === value
                  ? {
                      borderColor:
                        value === 'victoire'
                          ? 'var(--ok)'
                          : value === 'defaite'
                            ? 'var(--danger)'
                            : 'var(--border-strong)',
                      color:
                        value === 'victoire'
                          ? 'var(--ok)'
                          : value === 'defaite'
                            ? 'var(--danger)'
                            : 'var(--text)',
                    }
                  : {}),
              }}
              onClick={() => onChange({ ...analysis, outcome: value })}
            >
              {OUTCOME_LABELS[value]}
            </button>
          ))}
          {analysis.officialStats && (
            <span className="tag">
              Tableau des scores : {analysis.officialStats.kills}/{analysis.officialStats.deaths}/
              {analysis.officialStats.assists} · {analysis.officialStats.score} pts
            </span>
          )}
        </div>

        <p className="hint" style={{ marginBottom: 0 }}>
          {GAME_PROFILES[analysis.profile].name} · {analysis.video.name} ·{' '}
          {formatDuration(analysis.video.durationS)}
          {analysis.segmentCount > 1
            ? ` · match ${analysis.segmentIndex}/${analysis.segmentCount}, a partir de ${formatDuration(offsetS)} dans la rediffusion`
            : ''}{' '}
          · analyse le {new Date(analysis.createdAt).toLocaleString('fr-FR')}
        </p>
      </div>

      <div className="two-col" style={{ marginTop: 16 }}>
        <div>
          <div className="card">
            {videoUrl ? (
              <video
                ref={videoRef}
                className="player"
                src={videoUrl}
                controls
                playsInline
                onLoadedMetadata={(e) => {
                  // Un fichier rattache s'ouvre au debut : on se place sur le match.
                  if (offsetS > 0) e.currentTarget.currentTime = offsetS;
                }}
                onTimeUpdate={(e) => {
                  const relative = e.currentTarget.currentTime - offsetS;
                  // Ne pas deborder sur le match suivant de la meme rediffusion.
                  if (relative > analysis.video.durationS + 0.5) {
                    e.currentTarget.pause();
                    seek(analysis.video.durationS);
                    return;
                  }
                  setCurrentTime(Math.min(analysis.video.durationS, Math.max(0, relative)));
                }}
              />
            ) : (
              <div className="player-missing">
                <p style={{ marginTop: 0 }}>
                  La video n'est pas conservee dans l'application (les fichiers sont trop lourds
                  pour le stockage local). Rattachez-la pour revoir les moments cles
                  {analysis.segmentCount > 1
                    ? ' : rattachez la rediffusion complete, la lecture se placera toute seule sur ce match.'
                    : '.'}
                </p>
                <button className="btn-ghost" onClick={() => attachRef.current?.click()}>
                  Rattacher la video
                </button>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <Timeline
                features={analysis.features}
                intensity={intensity}
                engagements={local.engagements}
                events={analysis.events}
                durationS={analysis.video.durationS}
                currentTimeS={currentTime}
                onSeek={seek}
                selectedEventId={selectedId}
              />
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => seek(Math.max(0, currentTime - 5))}>
                −5 s
              </button>
              <span className="tag" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatDuration(currentTime)} / {formatDuration(analysis.video.durationS)}
              </span>
              <button
                className="btn-ghost"
                onClick={() => seek(Math.min(analysis.video.durationS, currentTime + 5))}
              >
                +5 s
              </button>
            </div>

            <h3 style={{ marginTop: 16 }}>Marquer l'instant courant</h3>
            <div className="marker-buttons">
              {MARKABLE.map((type) => (
                <button key={type} onClick={() => addEvent(type)}>
                  {EVENT_TYPES[type].label}
                  {EVENT_TYPES[type].hotkey ? ` (${EVENT_TYPES[type].hotkey.toUpperCase()})` : ''}
                </button>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
              Espace : lecture/pause · Fleches : ±5 s (±1 s avec Maj). Vos marquages alimentent les
              compteurs et sont transmis a l'IA comme verite terrain.
            </p>
          </div>

          <AiPanel
            report={analysis.ai}
            busy={aiBusy}
            enabled={settings.aiEnabled && settings.apiKey.trim().length > 0}
            error={aiError}
            onRun={() => void runAi()}
            onSeek={seek}
          />
        </div>

        <div>
          <div className="card">
            <h2>Mesures</h2>
            <MetricGrid metrics={analysis.metrics} officialStats={analysis.officialStats} />
          </div>

          <MapPanel
            analysis={analysis}
            mapLibrary={mapLibrary}
            readMapName={analysis.readMapName ?? ''}
            onConfirm={(name, existingId) => onConfirmMap(analysis, name, existingId)}
          />

          <div className="card">
            <h2>Profil de jeu</h2>
            <ScoreBars scores={analysis.metrics.scores} />
            <p className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
              Ces scores sont des reperes de lecture calcules sur votre propre video, pas un
              classement officiel EVA. Ils servent a comparer vos matchs entre eux.
            </p>
          </div>

          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>Timeline</h2>
              <div className="spacer" />
            </div>
            <div className="marker-buttons" style={{ marginBottom: 10 }}>
              {(['all', 'manual', 'ai', 'local'] as SourceFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={
                    filter === f
                      ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
                      : undefined
                  }
                >
                  {{ all: 'Tout', manual: 'Marques', ai: 'IA', local: 'Signaux' }[f]} ({counts[f]})
                </button>
              ))}
            </div>
            <EventList
              events={visibleEvents}
              selectedId={selectedId}
              onSelect={(e) => {
                setSelectedId(e.id);
                seek(e.t);
              }}
              onDelete={removeEvent}
            />
          </div>

          <div className="card">
            <h2>Notes</h2>
            <textarea
              value={analysis.notes}
              placeholder="Contexte du match, ressenti, consignes d'equipe... Ces notes sont transmises a l'IA."
              onChange={(e) => onChange({ ...analysis, notes: e.target.value })}
            />
          </div>
        </div>
      </div>
    </>
  );
}
