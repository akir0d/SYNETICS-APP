import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import type { Callout, CalloutMap } from '../../core/callouts/quiz';

export type MarkerTone = 'neutral' | 'selected' | 'target' | 'ok' | 'bad' | 'mastered';

interface CalloutBoardProps {
  map: CalloutMap;
  /** Reperes a afficher ; les autres endroits restent invisibles. */
  markers: ReadonlyArray<{ callout: Callout; tone: MarkerTone; label?: boolean }>;
  /** Toucher sur le plan, en fractions de l'image. */
  onTap?: (x: number, y: number) => void;
  onMarkerTap?: (callout: Callout) => void;
  /** Elements superposes en plus des reperes (point touche, par exemple). */
  overlay?: ReactNode;
}

const ZOOMS = [1, 1.5, 2, 3];

/**
 * Plan de la carte avec ses reperes, zoomable.
 *
 * Les positions sont stockees en fractions de l'image : elles restent justes
 * quel que soit le zoom ou la taille de l'ecran.
 */
export function CalloutBoard({ map, markers, onTap, onMarkerTap, overlay }: CalloutBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onTap || !boardRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    onTap(x, y);
  };

  return (
    <div>
      <div className="cmap-viewport">
        <div
          ref={boardRef}
          className="cmap-board"
          style={{ width: `${zoom * 100}%`, cursor: onTap ? 'crosshair' : 'default' }}
          onClick={handleClick}
        >
          <img src={map.image} alt={`Plan de ${map.name}`} draggable={false} />
          {markers.map(({ callout, tone, label }) => (
            <button
              key={callout.id}
              type="button"
              className={`cmap-marker tone-${tone}`}
              style={{ left: `${callout.x * 100}%`, top: `${callout.y * 100}%` }}
              onClick={(e) => {
                if (!onMarkerTap) return;
                e.stopPropagation();
                onMarkerTap(callout);
              }}
              aria-label={callout.name}
            >
              {label && <span>{callout.name}</span>}
            </button>
          ))}
          {overlay}
        </div>
      </div>
      <div className="row" style={{ marginTop: 8, gap: 6 }}>
        <span className="hint" style={{ margin: 0 }}>
          Zoom
        </span>
        {ZOOMS.map((z) => (
          <button
            key={z}
            type="button"
            className="btn-ghost"
            style={{
              padding: '3px 10px',
              ...(zoom === z ? { borderColor: 'var(--accent-dim)', color: 'var(--accent)' } : {}),
            }}
            onClick={() => setZoom(z)}
          >
            ×{z}
          </button>
        ))}
      </div>
    </div>
  );
}
