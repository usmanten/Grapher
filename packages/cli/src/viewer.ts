import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { renderViewer, type ScanResult, type Graph } from '@grapher/core';

const require = createRequire(import.meta.url);

/** Reads the viewer page template that ships with Grapher (not a user file). */
export async function loadViewerTemplate(): Promise<string> {
  let file: string;
  try {
    file = require.resolve('@grapher/viewer/template.html');
  } catch {
    throw new Error('The viewer has not been built yet. Run `pnpm build` first.');
  }
  return readFile(file, 'utf8');
}

/** Builds the viewer page for a project. */
export function viewerPage(
  template: string,
  graph: Graph,
  scan: ScanResult,
  explanations: Record<string, string> = {},
): string {
  return renderViewer(template, {
    graph,
    root: scan.root,
    explanations,
    protectedFiles: scan.skipped.filter((s) => s.reason === 'secret-file').map((s) => s.path),
  });
}
