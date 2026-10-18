import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';

import type { Graph } from '../graph/types.js';

export const OUTPUT_DIR = '.grapher';

async function isSymlink(target: string): Promise<boolean> {
  try {
    return (await lstat(target)).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Writes a file without following a symlink planted at its path. */
async function writeNoFollow(target: string, contents: string): Promise<void> {
  const handle = await open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    0o644,
  );
  try {
    await handle.writeFile(contents, 'utf8');
  } finally {
    await handle.close();
  }
}

/**
 * Saves the graph to `<root>/.grapher/graph.json` and returns its path.
 *
 * Refuses to write through symlinks, so a crafted project can't redirect
 * Grapher's output to overwrite a file elsewhere. The folder gets its own
 * .gitignore so output isn't committed by accident.
 */
export async function writeGraph(root: string, graph: Graph): Promise<string> {
  const dir = path.join(root, OUTPUT_DIR);
  if (await isSymlink(dir)) throw new Error(`Refusing to write: ${OUTPUT_DIR} is a symlink`);
  await mkdir(dir, { recursive: true });
  await writeNoFollow(path.join(dir, '.gitignore'), '*\n');
  const file = path.join(dir, 'graph.json');
  await writeNoFollow(file, `${JSON.stringify(graph, null, 2)}\n`);
  return file;
}
