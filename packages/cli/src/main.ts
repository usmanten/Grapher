import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { scanProject } from '@grapher/core';

import { formatScanSummary } from './format.js';

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

const HELP = `Usage: grapher <command> [options]

Commands:
  scan [folder]   List the files Grapher would analyze, and what it skips

Options:
  --json          Print machine-readable output
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
  if (command !== 'scan' || extra.length > 0) {
    io.err(`Unknown command: ${positionals.join(' ')}\n\n${HELP}`);
    return 2;
  }

  try {
    const result = await scanProject(folder);
    io.out(values.json ? JSON.stringify(result, null, 2) : formatScanSummary(result));
    return 0;
  } catch (error) {
    io.err(`grapher: ${(error as Error).message}`);
    return 1;
  }
}
