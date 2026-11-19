import pc from 'picocolors';
import { STATUS, RULE } from './ui.js';

const ORDER = ['done', 'confirmed', 'already', 'planned', 'failed', 'skipped'];
const LABEL = { done: 'done', confirmed: 'confirmed', already: 'already there', planned: 'planned', failed: 'failed', skipped: 'skipped' };
const COLOR = { done: pc.green, confirmed: pc.cyan, already: pc.dim, planned: pc.blue, failed: pc.red, skipped: pc.yellow };
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export const fmtDuration = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};
export const fmtKb = (kb) => {
  if (kb == null) return '—';
  const abs = Math.abs(kb);
  if (abs >= 1024 ** 2) return `${(kb / 1024 ** 2).toFixed(1)} GB`;
  if (abs >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
};

/** Terminal (colored) + markdown report. */
export function renderReport(results, { dryRun, runDir, sys, startedAt, endedAt, diskStartKb, diskEndKb }) {
  const groups = Object.fromEntries(ORDER.map((s) => [s, results.filter((r) => r.status === s).sort(byName)]));
  const counts = ORDER.filter((s) => s !== 'planned' || dryRun)
    .filter((s) => s !== 'planned' || groups.planned.length || dryRun)
    .map((s) => `${STATUS[s]} ${groups[s].length} ${LABEL[s]}`);
  const title = dryRun ? '📋 Dry-run report' : '📋 Report';
  const logPath = `${runDir}/output.log`;
  const used = diskStartKb - diskEndKb;

  const t = [`\n${RULE}`, pc.bold(title), RULE, counts.join('   '), ''];
  for (const s of ORDER) {
    if (!groups[s].length) continue;
    t.push(COLOR[s](pc.bold(`${STATUS[s]} ${LABEL[s][0].toUpperCase()}${LABEL[s].slice(1)}`)));
    for (const r of groups[s]) {
      let line = `   ${r.emoji ?? ''} ${r.name}`;
      if (s === 'done') line += pc.dim(`  ${fmtDuration(r.durationMs)}${r.sizeKb != null ? ` · ${fmtKb(r.sizeKb)}` : ''}${r.version ? ` · ${r.version}` : ''}`);
      if (s === 'failed') line += pc.red(`  exit ${r.exitCode ?? '?'} · see ${logPath}`);
      if (s === 'skipped' && r.note) line += pc.dim(`  (${r.note})`);
      t.push(line);
      if (s === 'failed') for (const l of (r.tail ?? []).slice(-5)) t.push(pc.dim(`      │ ${l}`));
      if (s === 'planned') for (const c of r.commands ?? []) t.push(pc.dim(`      $ ${c}`));
    }
    t.push('');
  }
  t.push(RULE);
  t.push(`⏱️  ${fmtDuration(endedAt - startedAt)}   💾 Disk used: ${fmtKb(used)}`);
  t.push(`📁 Run folder: ${runDir}`);
  if (!dryRun) t.push(pc.bold('🔁 Open a new terminal (or run: exec zsh) to load .zshrc changes'));

  const md = [`# ${title}`, '',
    `- Mac: ${sys.model} · macOS ${sys.macos} · ${sys.arch}`,
    `- Started: ${startedAt.toISOString()} · Duration: ${fmtDuration(endedAt - startedAt)} · Disk used: ${fmtKb(used)}`,
    `- ${counts.join(' · ')}`, '',
    '| Item | Status | Duration | Size | Version | Attempts |',
    '|---|---|---|---|---|---|',
    ...ORDER.flatMap((s) => groups[s].map((r) =>
      `| ${r.name} | ${STATUS[s]} ${s} | ${fmtDuration(r.durationMs)} | ${fmtKb(r.sizeKb)} | ${r.version ?? '—'} | ${r.attempts} |`)),
  ];
  const failed = groups.failed;
  if (failed.length) {
    md.push('', '## ❌ Failures');
    for (const r of failed) md.push('', `### ${r.name} (exit ${r.exitCode ?? '?'})`, '```', ...(r.tail ?? []), '```');
  }
  if (dryRun && groups.planned.length) {
    md.push('', '## 📝 Planned commands');
    for (const r of groups.planned) md.push('', `**${r.name}**`, '```', ...(r.commands ?? []), '```');
  }
  md.push('', `Full log: \`${logPath}\``, '');
  return { terminal: t.join('\n'), markdown: md.join('\n') };
}
