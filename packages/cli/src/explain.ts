import {
  ANSWERS_FILE,
  analyzeProject,
  BATCH_SIZE,
  currentExplanations,
  explainPrompt,
  explainTasks,
  type Graph,
  loadCache,
  OUTPUT_DIR,
  parseAnswers,
  readOutputFile,
  removeOutputFile,
  saveCache,
  type ScanResult,
  writeGraph,
  writeViewer,
} from '@grapher/core';

import { loadViewerTemplate, viewerPage } from './viewer.js';

const ANSWERS_NAME = ANSWERS_FILE.slice(OUTPUT_DIR.length + 1);

/** Writes graph.json and index.html, with any explanations that still match the code. */
export async function writeOutputs(
  graph: Graph,
  scan: ScanResult,
  explanations: Record<string, string>,
): Promise<string> {
  // Both outputs are built and checked for secrets before either is written.
  const html = viewerPage(await loadViewerTemplate(), graph, scan, explanations);
  await writeGraph(scan.root, graph);
  return writeViewer(scan.root, html);
}

function saveCommand(folder: string): string {
  return folder === '.'
    ? 'grapher explain --save'
    : `grapher explain ${JSON.stringify(folder)} --save`;
}

/**
 * Maps the project, then prints the next batch of connections for Claude to
 * explain, or a note that everything is already explained.
 */
export async function explainRequest(folder: string): Promise<string> {
  const { graph, scan } = await analyzeProject(folder);
  const cache = await loadCache(scan.root);
  await writeOutputs(graph, scan, currentExplanations(graph, cache));
  const tasks = explainTasks(graph, cache);
  if (tasks.length === 0) {
    return `All ${graph.connections.length} connections are explained. Open ${OUTPUT_DIR}/index.html to read them.`;
  }
  return explainPrompt(tasks.slice(0, BATCH_SIZE), tasks.length, saveCommand(folder));
}

/** Reads Claude's answer, saves the explanations, and refreshes the page. */
export async function explainSave(folder: string): Promise<string> {
  const { graph, scan } = await analyzeProject(folder);
  const raw = await readOutputFile(scan.root, ANSWERS_NAME);
  if (raw === undefined) {
    throw new Error(`No answer found. Write the explanations to ${ANSWERS_FILE} first.`);
  }
  const cache = await loadCache(scan.root);
  const tasks = explainTasks(graph, cache);
  const { accepted, skipped } = parseAnswers(raw, tasks);
  for (const task of tasks) {
    const text = accepted[task.id];
    if (text !== undefined) cache.entries[task.id] = { fingerprint: task.fingerprint, text };
  }
  await saveCache(scan.root, cache);
  await removeOutputFile(scan.root, ANSWERS_NAME);
  await writeOutputs(graph, scan, currentExplanations(graph, cache));

  const saved = Object.keys(accepted).length;
  const left = tasks.length - saved;
  const lines = [
    `Saved ${saved} explanation${saved === 1 ? '' : 's'} and updated ${OUTPUT_DIR}/index.html.`,
  ];
  if (skipped.length > 0)
    lines.push(`Ignored ${skipped.length} answer(s) for connections that weren't asked about.`);
  lines.push(
    left > 0
      ? `${left} connection${left === 1 ? '' : 's'} still need an explanation. Run ${saveCommand(folder).replace(' --save', '')} for the next batch.`
      : 'Every connection is explained.',
  );
  return lines.join('\n');
}
