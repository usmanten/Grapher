import { realpath } from 'node:fs/promises';

import {
  ANSWERS_FILE,
  type AnalysisResult,
  analyzeProject,
  BATCH_SIZE,
  currentExplanations,
  explainPrompt,
  explainTasks,
  type Graph,
  type IdentifiedPackage,
  identifyPrompt,
  loadCache,
  loadIdentified,
  PACKAGE_BATCH_SIZE,
  parseIdentified,
  OUTPUT_DIR,
  parseAnswers,
  readOutputFile,
  removeOutputFile,
  saveCache,
  saveIdentified,
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

/** Maps the project, using the packages Claude identified in earlier runs. */
export async function analyze(
  folder: string,
): Promise<AnalysisResult & { identified: Map<string, IdentifiedPackage> }> {
  let identified = new Map<string, IdentifiedPackage>();
  try {
    identified = await loadIdentified(await realpath(folder));
  } catch {
    // A missing folder is reported by analyzeProject below.
  }
  const result = await analyzeProject(folder, { identified });
  return { ...result, identified };
}

/** Packages Grapher doesn't know that Claude hasn't been asked about yet. */
function packagesToIdentify(graph: Graph, identified: ReadonlyMap<string, unknown>): string[] {
  return graph.unknownPackages.filter((name) => !identified.has(name)).slice(0, PACKAGE_BATCH_SIZE);
}

function saveCommand(folder: string): string {
  return folder === '.'
    ? 'grapher explain --save'
    : `grapher explain ${JSON.stringify(folder)} --save`;
}

/**
 * Maps the project, then prints the next request for Claude: first the
 * packages Grapher doesn't know, by name only, then batches of connections
 * to explain. Says so when everything is done.
 */
export async function explainRequest(folder: string): Promise<string> {
  const { graph, scan, identified } = await analyze(folder);
  const cache = await loadCache(scan.root);
  await writeOutputs(graph, scan, currentExplanations(graph, cache));
  const packages = packagesToIdentify(graph, identified);
  if (packages.length > 0) return identifyPrompt(packages, saveCommand(folder));
  const tasks = explainTasks(graph, cache);
  if (tasks.length === 0) {
    return `All ${graph.connections.length} connections are explained. Open ${OUTPUT_DIR}/index.html to read them.`;
  }
  return explainPrompt(tasks.slice(0, BATCH_SIZE), tasks.length, saveCommand(folder));
}

/** Saves what Claude said the unknown packages are, and maps the project again. */
async function savePackages(
  folder: string,
  root: string,
  raw: string,
  packages: readonly string[],
  identified: Map<string, IdentifiedPackage>,
): Promise<string> {
  const answers = parseIdentified(raw, packages);
  for (const [name, entry] of answers) identified.set(name, entry);
  await saveIdentified(root, identified);
  await removeOutputFile(root, ANSWERS_NAME);
  const { graph, scan } = await analyzeProject(folder, { identified });
  await writeOutputs(graph, scan, currentExplanations(graph, await loadCache(scan.root)));

  const found = [...answers.values()].filter((e) => e.kind === 'service' || e.kind === 'database');
  const lines = [
    `Identified ${answers.size} package${answers.size === 1 ? '' : 's'}: ${found.length} added to the map as outside services or databases.`,
  ];
  const left = packagesToIdentify(graph, identified).length;
  lines.push(
    left > 0
      ? `${left} more package${left === 1 ? '' : 's'} to identify. Run ${saveCommand(folder).replace(' --save', '')} for the next step.`
      : `Run ${saveCommand(folder).replace(' --save', '')} for the next step.`,
  );
  return lines.join('\n');
}

/**
 * Reads Claude's answer to the last request, saves it, and refreshes the
 * page. The request it answers is worked out again from the project, so a
 * package answer can't be saved as explanations or the other way round.
 */
export async function explainSave(folder: string): Promise<string> {
  const { graph, scan, identified } = await analyze(folder);
  const raw = await readOutputFile(scan.root, ANSWERS_NAME);
  if (raw === undefined) {
    throw new Error(`No answer found. Write the answer to ${ANSWERS_FILE} first.`);
  }
  const packages = packagesToIdentify(graph, identified);
  if (packages.length > 0) return savePackages(folder, scan.root, raw, packages, identified);

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
