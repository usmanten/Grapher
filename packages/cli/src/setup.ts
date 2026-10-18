import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFileSafely } from './files.js';

/** Marks command files Grapher wrote, so it only ever replaces its own. */
const MARKER = '<!-- Installed by `grapher setup`.';

/**
 * How the command file runs Grapher: the Node.js binary and this CLI's own
 * entry point. Quoted so folders with spaces work.
 */
export function grapherInvocation(): string {
  const entry = fileURLToPath(new URL('./index.js', import.meta.url));
  return [process.execPath, entry]
    .map((part) => (/[\s"'$`\\]/.test(part) ? JSON.stringify(part) : part))
    .join(' ');
}

/** The /grapher command file, filled in for this installation. */
export async function commandFile(invocation: string): Promise<string> {
  const template = await readFile(new URL('../assets/grapher-command.md', import.meta.url), 'utf8');
  return template.replaceAll('{{GRAPHER}}', () => invocation);
}

/**
 * Installs the /grapher command for Claude Code into the user's own commands
 * folder, so it works in every project and is never committed to one.
 */
export async function setup(claudeDir = path.join(homedir(), '.claude')): Promise<string> {
  const target = path.join(claudeDir, 'commands', 'grapher.md');
  let existing: string | undefined;
  try {
    existing = await readFile(target, 'utf8');
  } catch {
    existing = undefined;
  }
  if (existing !== undefined && !existing.includes(MARKER)) {
    throw new Error(
      `${target} already exists and wasn't written by Grapher, so it was left alone.`,
    );
  }
  await writeFileSafely(target, await commandFile(grapherInvocation()));
  return target;
}
