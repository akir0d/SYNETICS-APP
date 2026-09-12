import type { MatchAnalysis } from './types';
import { EVENT_TYPES, GAME_PROFILES } from './types';
import { formatDuration } from './analysis/metrics';

/** Exports : l'analyse doit pouvoir sortir de l'app, pas y rester prisonniere. */

export function toJson(analysis: MatchAnalysis): string {
  return JSON.stringify(analysis, null, 2);
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function eventsToCsv(analysis: MatchAnalysis): string {
  const header = ['temps_s', 'temps_mmss', 'type', 'libelle', 'source', 'confiance', 'commentaire'];
  const rows = [...analysis.events]
    .sort((a, b) => a.t - b.t)
    .map((e) => [
      e.t.toFixed(2),
      formatDuration(e.t),
      EVENT_TYPES[e.type].label,
      e.label ?? '',
      e.source,
      e.confidence.toFixed(2),
      e.comment ?? '',
    ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\n');
}

export function toMarkdown(analysis: MatchAnalysis): string {
  const m = analysis.metrics;
  const out: string[] = [];

  out.push(`# ${analysis.title}`);
  out.push('');
  out.push(`- Mode : ${GAME_PROFILES[analysis.profile].name}`);
  out.push(`- Video : ${analysis.video.name} (${formatDuration(analysis.video.durationS)})`);
  out.push(`- Analyse du ${new Date(analysis.createdAt).toLocaleString('fr-FR')}`);
  out.push('');
  out.push('## Mesures');
  out.push('');
  out.push('| Indicateur | Valeur |');
  out.push('| --- | --- |');
  out.push(`| Phases d'action | ${m.engagementCount} |`);
  out.push(`| Temps en action | ${Math.round(m.activeRatio * 100)} % |`);
  out.push(`| Phase moyenne | ${m.meanEngagementS.toFixed(1)} s |`);
  out.push(`| Plus longue accalmie | ${formatDuration(m.longestCalmS)} |`);
  out.push(`| Rythme | ${m.tempoPerMin.toFixed(1)} / min |`);
  out.push(`| Expositions detectees | ${m.exposureEvents} |`);
  out.push(`| Eliminations / morts | ${m.kills} / ${m.deaths} |`);
  out.push(
    `| Scores | agressivite ${m.scores.aggression} · regularite ${m.scores.consistency} · discipline ${m.scores.discipline} · tempo ${m.scores.tempo} |`,
  );
  out.push('');

  if (analysis.ai) {
    const ai = analysis.ai;
    out.push(`## Analyse IA (${ai.model})`);
    out.push('');
    out.push(ai.summary);
    out.push('');
    out.push('### Points forts');
    out.push(...ai.strengths.map((s) => `- ${s}`));
    out.push('');
    out.push('### Axes de progres');
    out.push(...ai.weaknesses.map((s) => `- ${s}`));
    out.push('');
    out.push('### Exercices');
    for (const d of ai.drills) out.push(`- **${d.title}** (${d.focus}) — ${d.description}`);
    out.push('');
    out.push(`> Limites relevees par l'IA : ${ai.caveats}`);
    out.push('');
  }

  out.push('## Timeline');
  out.push('');
  out.push('| Temps | Type | Libelle | Source | Confiance |');
  out.push('| --- | --- | --- | --- | --- |');
  for (const e of [...analysis.events].sort((a, b) => a.t - b.t)) {
    out.push(
      `| ${formatDuration(e.t)} | ${EVENT_TYPES[e.type].label} | ${e.label ?? ''} | ${e.source} | ${Math.round(e.confidence * 100)} % |`,
    );
  }

  if (analysis.notes.trim()) {
    out.push('');
    out.push('## Notes');
    out.push('');
    out.push(analysis.notes.trim());
  }

  return out.join('\n');
}

export function slugify(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'analyse'
  );
}
