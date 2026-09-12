import type { MatchMetrics } from '../../core/types';
import { formatDuration } from '../../core/analysis/metrics';

export function MetricGrid({ metrics }: { metrics: MatchMetrics }) {
  const items: Array<{ value: string; label: string }> = [
    { value: formatDuration(metrics.durationS), label: 'Duree analysee' },
    { value: String(metrics.engagementCount), label: "Phases d'action" },
    { value: `${Math.round(metrics.activeRatio * 100)} %`, label: 'Temps en action' },
    { value: `${metrics.meanEngagementS.toFixed(1)} s`, label: 'Phase moyenne' },
    { value: formatDuration(metrics.longestCalmS), label: 'Plus longue accalmie' },
    { value: metrics.tempoPerMin.toFixed(1), label: 'Engagements / min' },
    { value: String(metrics.exposureEvents), label: 'Expositions detectees' },
    {
      value: metrics.kd === null ? '—' : metrics.kd.toFixed(2),
      label: `K/D marque (${metrics.kills}/${metrics.deaths})`,
    },
  ];

  return (
    <div className="metric-grid">
      {items.map((item) => (
        <div className="metric" key={item.label}>
          <div className="value">{item.value}</div>
          <div className="label">{item.label}</div>
        </div>
      ))}
    </div>
  );
}
