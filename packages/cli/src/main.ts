import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { analyzeProject, OUTPUT_DIR, scanProject, writeGraph, writeViewer } from '@grapher/core';

import { formatGraphSummary, formatScanSummary } from './format.js';
import { loadViewerTemplate, viewerPage } from './viewer.js';

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

const HELP = `Usage: grapher <command> [options]

Commands:
  graph [folder]  Map how the project connects and save it to .grapher/
                  (open .grapher/index.html in your browser to explore it)
  scan [folder]   List the files Grapher would analyze, and what it skips

Options:
  --json          Print machine-readable output instead (nothing is saved)
  -h, --help      Show this help
  -v, --version   Show the version`;

async function readVersion(): Promise<string> {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

/** Runs the CLI and returns the process exit code. */
export async function main(argv: readonly string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (error) {
    io.err(`${(error as Error).message}\n\n${HELP}`);
    return 2;
  }

  const { values, positionals } = parsed;
  if (values.version) {
    io.out(await readVersion());
    return 0;
  }
  const [command, folder = '.', ...extra] = positionals;
  if (values.help || command === undefined) {
    io.out(HELP);
    return 0;
  }
  if ((command !== 'scan' && command !== 'graph') || extra.length > 0) {
    io.err(`Unknown command: ${positionals.join(' ')}\n\n${HELP}`);
    return 2;
  }

  try {
    if (command === 'scan') {
      const result = await scanProject(folder);
      io.out(values.json ? JSON.stringify(result, null, 2) : formatScanSummary(result));
      return 0;
    }
    const { graph, scan } = await analyzeProject(folder);
    if (values.json) {
      io.out(JSON.stringify(graph, null, 2));
      return 0;
    }
    const template = await loadViewerTemplate();
    await writeGraph(scan.root, graph);
    const page = await writeViewer(scan.root, viewerPage(template, graph, scan));
    io.out(
      `${formatGraphSummary(graph)}\n\nSaved ${OUTPUT_DIR}/graph.json and ${OUTPUT_DIR}/index.html\nOpen it in your browser: ${pathToFileURL(page).href}`,
    );
    return 0;
  } catch (error) {
    io.err(`grapher: ${(error as Error).message}`);
    return 1;
  }
}
