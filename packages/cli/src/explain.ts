import { realpath } from 'node:fs/promises';

import {
  ANSWERS_FILE,
  type AnalysisResult,
  analyzeProject,
  currentExplanations,
  explainPrompt,
  explainTasks,
  type ExplanationCache,
  type Graph,
  type IdentifiedPackage,
  identifyPrompt,
  loadCache,
  loadIdentified,
  loadRequest,
  nextBatch,
  PACKAGE_BATCH_SIZE,
  parseIdentified,
  OUTPUT_DIR,
  parseAnswers,
  readOutputFile,
  removeOutputFile,
  REQUEST_FILE,
  saveCache,
  saveIdentified,
  saveRequest,
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
 * The next request for Claude: first the packages Grapher doesn't know, by
 * name only, then batches of connections to explain. Says so when
 * everything is done.
 */
async function nextRequest(
  folder: string,
  root: string,
  graph: Graph,
  identified: ReadonlyMap<string, unknown>,
  cache: ExplanationCache,
): Promise<string> {
  const packages = packagesToIdentify(graph, identified);
  if (packages.length > 0) return identifyPrompt(packages, saveCommand(folder));
  const tasks = explainTasks(graph, cache);
  if (tasks.length === 0) {
    return `All ${graph.connections.length} connections are explained. Open ${OUTPUT_DIR}/index.html to read them.`;
  }
  const batch = nextBatch(tasks);
  const prompt = explainPrompt(batch, tasks.length, saveCommand(folder));
  // Remembers which connection each number stands for, for the save.
  await saveRequest(root, batch);
  return prompt;
}

/** Maps the project and prints the next request for Claude. */
export async function explainRequest(folder: string): Promise<string> {
  const { graph, scan, identified } = await analyze(folder);
  const cache = await loadCache(scan.root);
  await writeOutputs(graph, scan, currentExplanations(graph, cache));
  return nextRequest(folder, scan.root, graph, identified, cache);
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
  const cache = await loadCache(scan.root);
  await writeOutputs(graph, scan, currentExplanations(graph, cache));

  const found = [...answers.values()].filter((e) => e.kind === 'service' || e.kind === 'database');
  const summary = `Identified ${answers.size} package${answers.size === 1 ? '' : 's'}: ${found.length} added to the map as outside services or databases.`;
  return `${summary}\n\n${await nextRequest(folder, root, graph, identified, cache)}`;
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
  const requested = await loadRequest(scan.root, explainTasks(graph, cache));
  if (requested === undefined) {
    throw new Error(`No request found. Run ${saveCommand(folder).replace(' --save', '')} first.`);
  }
  const { accepted, skipped } = parseAnswers(raw, requested);
  for (const task of requested) {
    const text = task && accepted[task.id];
    if (task && text !== undefined) {
      cache.entries[task.id] = { fingerprint: task.fingerprint, text };
    }
  }
  await saveCache(scan.root, cache);
  await removeOutputFile(scan.root, ANSWERS_NAME);
  await removeOutputFile(scan.root, REQUEST_FILE);
  await writeOutputs(graph, scan, currentExplanations(graph, cache));

  const saved = Object.keys(accepted).length;
  const lines = [
    `Saved ${saved} explanation${saved === 1 ? '' : 's'} and updated ${OUTPUT_DIR}/index.html.`,
  ];
  if (skipped.length > 0)
    lines.push(
      `Ignored ${skipped.length} answer(s) for connections that weren't asked about or changed since.`,
    );
  if (explainTasks(graph, cache).length === 0) {
    lines.push('Every connection is explained.');
    return lines.join('\n');
  }
  // The next request is printed straight away, so Claude doesn't need an
  // extra step to ask for it.
  return `${lines.join('\n')}\n\n${await nextRequest(folder, scan.root, graph, identified, cache)}`;
}
