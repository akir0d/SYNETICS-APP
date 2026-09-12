import { useMemo, useRef } from 'react';
import type { Engagement, FrameFeature, MatchEvent } from '../../core/types';
import { EVENT_TYPES } from '../../core/types';
import { formatDuration } from '../../core/analysis/metrics';

interface TimelineProps {
  features: readonly FrameFeature[];
  intensity: readonly number[];
  engagements: readonly Engagement[];
  events: readonly MatchEvent[];
  durationS: number;
  currentTimeS: number;
  onSeek: (t: number) => void;
  selectedEventId?: string | undefined;
}

const W = 1000;
const H = 150;
const PAD_BOTTOM = 22;

/**
 * Vue d'ensemble du match : intensite d'action, phases detectees et
 * evenements. Cliquer n'importe ou deplace la lecture a cet instant.
 */
export function Timeline({
  features,
  intensity,
  engagements,
  events,
  durationS,
  currentTimeS,
  onSeek,
  selectedEventId,
}: TimelineProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const plotH = H - PAD_BOTTOM;
  const x = (t: number) => (durationS > 0 ? (t / durationS) * W : 0);

  const areaPath = useMemo(() => {
    if (features.length === 0) return '';
    const points = features.map((f, i) => {
      const value = intensity[i] ?? 0;
      return `${x(f.t).toFixed(2)},${(plotH - value * (plotH - 8)).toFixed(2)}`;
    });
    return `M0,${plotH} L${points.join(' L')} L${W},${plotH} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, intensity, durationS, plotH]);

  const handlePointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || durationS <= 0) return;
    const rect = svg.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * durationS);
  };

  // Un marqueur par type et par instant suffit : on ne superpose pas dix
  // triangles identiques quand plusieurs sources decrivent le meme moment.
  const markers = useMemo(() => {
    const seen = new Set<string>();
    return events
      .filter((e) => e.type !== 'engagement_start' && e.type !== 'engagement_end')
      .filter((e) => {
        const key = `${e.type}-${e.t.toFixed(1)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [events]);

  const legendTypes = useMemo(
    () => [...new Set(markers.map((m) => m.type))],
    [markers],
  );

  return (
    <div className="timeline-wrap">
      <svg
        ref={svgRef}
        className="timeline-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onPointerDown={handlePointer}
        role="slider"
        aria-label="Timeline du match"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationS)}
        aria-valuenow={Math.round(currentTimeS)}
        tabIndex={0}
      >
        <rect x={0} y={0} width={W} height={plotH} fill="#0d131f" />

        {engagements.map((eng, i) => (
          <rect
            key={`eng-${i}`}
            x={x(eng.startS)}
            y={0}
            width={Math.max(1, x(eng.endS) - x(eng.startS))}
            height={plotH}
            fill="rgba(251, 191, 36, 0.12)"
          />
        ))}

        <path d={areaPath} fill="rgba(77, 224, 200, 0.28)" stroke="#4de0c8" strokeWidth={1.2} />

        {markers.map((event) => {
          const meta = EVENT_TYPES[event.type];
          const px = x(event.t);
          const isSelected = event.id === selectedEventId;
          return (
            <g key={event.id}>
              <line
                x1={px}
                y1={0}
                x2={px}
                y2={plotH}
                stroke={meta.color}
                strokeWidth={isSelected ? 2 : 1}
                opacity={isSelected ? 0.9 : 0.35}
              />
              <polygon
                points={`${px - 4},${plotH + 2} ${px + 4},${plotH + 2} ${px},${plotH + 9}`}
                fill={meta.color}
                opacity={event.source === 'local' ? 0.65 : 1}
              />
            </g>
          );
        })}

        <line
          x1={x(currentTimeS)}
          y1={0}
          x2={x(currentTimeS)}
          y2={plotH}
          stroke="#ffffff"
          strokeWidth={1.5}
        />

        {[0, 0.25, 0.5, 0.75, 1].map((r) => (
          <text
            key={r}
            x={Math.min(W - 24, Math.max(18, r * W))}
            y={H - 6}
            fill="#8c9bb5"
            fontSize={11}
            textAnchor="middle"
          >
            {formatDuration(r * durationS)}
          </text>
        ))}
      </svg>

      <div className="timeline-legend">
        <span>
          <i style={{ background: 'rgba(251, 191, 36, 0.5)' }} /> Phase d'action
        </span>
        {legendTypes.map((type) => (
          <span key={type}>
            <i style={{ background: EVENT_TYPES[type].color }} /> {EVENT_TYPES[type].label}
          </span>
        ))}
      </div>
    </div>
  );
}
