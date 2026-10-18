import type { Graph, ScanResult, SkipReason } from '@grapher/core';

const REASON_LABELS: Record<SkipReason, string> = {
  'secret-file': 'secret files (never opened)',
  'secret-directory': 'credential folders (never opened)',
  'ignored-directory': 'dependency and build folders',
  gitignored: 'ignored by .gitignore',
  symlink: 'symlinks (not followed)',
  'too-large': 'files over the size limit',
  'not-a-file': 'special files',
};

/** Reasons the user should always see by name, because they explain a protection. */
const ALWAYS_LIST: ReadonlySet<SkipReason> = new Set(['secret-file', 'secret-directory']);
const MAX_LISTED = 5;

/** File names come from the project, so strip control characters that could rewrite the terminal. */
function printable(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?');
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Renders a scan as a short, readable summary for the terminal. */
export function formatScanSummary(scan: ScanResult): string {
  const lines = [
    `Scanned ${printable(scan.root)}`,
    `  ${plural(scan.files.length, 'file')} ready to analyze`,
  ];

  const groups = new Map<SkipReason, string[]>();
  for (const entry of scan.skipped) {
    const paths = groups.get(entry.reason) ?? [];
    paths.push(entry.path);
    groups.set(entry.reason, paths);
  }

  if (groups.size > 0) {
    lines.push('', '  Skipped:');
    for (const [reason, paths] of groups) {
      const shown = ALWAYS_LIST.has(reason) ? paths : paths.slice(0, MAX_LISTED);
      const more = paths.length - shown.length;
      const list = shown.map(printable).join(', ') + (more > 0 ? `, and ${more} more` : '');
      lines.push(`    ${paths.length} ${REASON_LABELS[reason]}: ${list}`);
    }
  }

  if (scan.truncated) {
    lines.push('', '  Stopped early: the file limit was reached. Is this the right folder?');
  }
  return lines.join('\n');
}

/** Summarizes a graph: what kinds of things were found, and any warnings. */
export function formatGraphSummary(graph: Graph): string {
  const count = (test: (n: Graph['nodes'][number]) => boolean) => graph.nodes.filter(test).length;
  const files = count((n) => n.kind === 'file');
  const pages = count((n) => n.kind === 'file' && n.role === 'page');
  const routes = count((n) => n.kind === 'file' && n.role === 'route');
  const databases = graph.nodes.filter((n) => n.kind === 'database').map((n) => n.label);
  const services = graph.nodes.flatMap((n) =>
    n.kind === 'service' && n.unidentified !== true ? [n.label] : [],
  );
  const settings = count((n) => n.kind === 'setting');

  const lines = [
    `Mapped ${printable(graph.project.name)}`,
    `  ${plural(files, 'file')}, including ${plural(pages, 'page')} and ${plural(routes, 'API route')}`,
    `  ${plural(graph.connections.length, 'connection')}`,
  ];
  if (databases.length > 0) lines.push(`  Databases: ${databases.map(printable).join(', ')}`);
  if (services.length > 0) lines.push(`  Outside services: ${services.map(printable).join(', ')}`);
  if (settings > 0) lines.push(`  ${plural(settings, 'setting')} (names only, never values)`);
  if (graph.unknownPackages.length > 0) {
    lines.push(`  Not yet identified: ${graph.unknownPackages.map(printable).join(', ')}`);
  }
  for (const warning of graph.warnings) lines.push('', `  Note: ${printable(warning.message)}`);
  return lines.join('\n');
}
