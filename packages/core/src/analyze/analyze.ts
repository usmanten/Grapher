import path from 'node:path';

import type { Graph } from '../graph/types.js';
import { type FileSystem, nodeFileSystem } from '../scan/fs.js';
import { createSourceReader } from '../scan/reader.js';
import { scanProject } from '../scan/scan.js';
import type { ScanOptions, ScanResult } from '../scan/types.js';
import { GraphBuilder } from './builder.js';
import type { IdentifiedPackages } from './known-packages.js';
import type { LanguagePack, LoadedPack } from './pack.js';
import { DEFAULT_PACKS } from './packs/index.js';
import { addSnippets } from './snippets.js';

export interface AnalyzeOptions extends ScanOptions {
  /** Packages Claude identified by name in an earlier run. */
  identified?: IdentifiedPackages;
  /** The language packs to use, in order of priority. Defaults to `DEFAULT_PACKS`. */
  packs?: readonly LanguagePack[];
}

export interface AnalysisResult {
  graph: Graph;
  scan: ScanResult;
}

/** Hands each scanned file to the first pack that claims it. */
function assignFiles(scan: ScanResult, packs: readonly LanguagePack[]): string[][] {
  const assigned = packs.map((): string[] => []);
  for (const { path: filePath } of scan.files) {
    const index = packs.findIndex((pack) => pack.claims(filePath));
    if (index >= 0) assigned[index]?.push(filePath);
  }
  return assigned;
}

/**
 * Scans a project and maps how its files, databases, outside services and
 * settings connect. Each language pack reads its own files; every file read
 * goes through the safe reader, and no network request is made.
 */
export async function analyzeProject(
  projectDir: string,
  options: AnalyzeOptions = {},
  fs: FileSystem = nodeFileSystem,
): Promise<AnalysisResult> {
  const scan = await scanProject(projectDir, options, fs);
  const reader = createSourceReader(scan, fs);
  const packs = options.packs ?? DEFAULT_PACKS;
  const builder = new GraphBuilder();

  const assigned = assignFiles(scan, packs);
  const loaded: LoadedPack[] = [];
  for (const [index, pack] of packs.entries()) {
    loaded.push(
      await pack.load({
        scan,
        reader,
        paths: assigned[index] ?? [],
        ...(options.identified ? { identified: options.identified } : {}),
      }),
    );
  }

  const texts = new Map<string, string>();
  for (const pack of loaded) {
    for (const file of pack.files) {
      builder.addNode(file.node);
      texts.set(file.node.path, file.text);
    }
    for (const warning of pack.warnings) builder.warn(warning);
  }
  if (scan.truncated) {
    builder.warn({
      code: 'truncated',
      message: 'The project has more files than the limit, so only part of it was mapped.',
    });
  }
  for (const problem of loaded.flatMap((pack) => pack.problems)) {
    builder.warn({ code: 'parse-error', message: `${problem.path}: ${problem.message}` });
  }

  for (const pack of loaded) pack.linkFiles(builder);
  for (const pack of loaded) await pack.findSpecialParts(builder);

  const name = loaded.find((pack) => pack.projectName)?.projectName ?? path.basename(scan.root);
  const framework = loaded.find((pack) => pack.framework)?.framework ?? 'unknown';
  const graph = builder.build({ name, framework });
  addSnippets(graph, texts);
  return { graph, scan };
}
