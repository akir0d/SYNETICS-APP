import type { MatchScores } from '../../core/types';

const DESCRIPTIONS: Record<keyof MatchScores, { label: string; help: string; color: string }> = {
  aggression: {
    label: 'Agressivite',
    help: "Part du match passee en phase d'action soutenue.",
    color: '#f87171',
  },
  tempo: {
    label: 'Tempo',
    help: "Frequence d'entree en engagement, par minute.",
    color: '#fbbf24',
  },
  consistency: {
    label: 'Regularite',
    help: 'Stabilite des intervalles entre deux engagements.',
    color: '#60a5fa',
  },
  discipline: {
    label: 'Discipline',
    help: "Exposition subie rapportee au temps passe en action.",
    color: '#4ade80',
  },
};

const ORDER: Array<keyof MatchScores> = ['aggression', 'tempo', 'consistency', 'discipline'];

export function ScoreBars({ scores }: { scores: MatchScores }) {
  return (
    <div className="score-grid">
      {ORDER.map((key) => {
        const meta = DESCRIPTIONS[key];
        const value = scores[key];
        return (
          <div className="score" key={key}>
            <div className="head">
              <span>{meta.label}</span>
              <b>{Math.round(value)}</b>
            </div>
            <div className="bar">
              <div style={{ width: `${Math.max(2, value)}%`, background: meta.color }} />
            </div>
            <p className="desc">{meta.help}</p>
          </div>
        );
      })}
    </div>
  );
}
