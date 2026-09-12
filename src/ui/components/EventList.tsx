import type { MatchEvent } from '../../core/types';
import { EVENT_TYPES } from '../../core/types';
import { formatDuration } from '../../core/analysis/metrics';

const SOURCE_LABEL: Record<MatchEvent['source'], string> = {
  local: 'signal',
  ai: 'IA',
  manual: 'marque',
};

interface EventListProps {
  events: readonly MatchEvent[];
  selectedId?: string | undefined;
  onSelect: (event: MatchEvent) => void;
  onDelete?: (event: MatchEvent) => void;
}

export function EventList({ events, selectedId, onSelect, onDelete }: EventListProps) {
  if (events.length === 0) {
    return <p className="hint">Aucun evenement pour ce filtre.</p>;
  }

  return (
    <div className="event-list">
      {events.map((event) => {
        const meta = EVENT_TYPES[event.type];
        return (
          <div
            key={event.id}
            className={`event${event.id === selectedId ? ' is-active' : ''}`}
            style={{ borderLeftColor: meta.color }}
            onClick={() => onSelect(event)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(event);
              }
            }}
          >
            <time>{formatDuration(event.t)}</time>
            <div>
              <div className="title">{event.label || meta.label}</div>
              <div className="meta">
                {meta.label} · {SOURCE_LABEL[event.source]} · {Math.round(event.confidence * 100)} %
                {event.comment ? ` · ${event.comment}` : ''}
              </div>
            </div>
            {onDelete && event.source === 'manual' ? (
              <button
                className="btn-ghost"
                style={{ padding: '4px 9px' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(event);
                }}
                aria-label={`Supprimer le marquage a ${formatDuration(event.t)}`}
              >
                ×
              </button>
            ) : (
              <span className="badge">{SOURCE_LABEL[event.source]}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
