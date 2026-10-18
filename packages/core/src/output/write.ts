import { constants } from 'node:fs';
import { lstat, mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';

import type { Graph } from '../graph/types.js';
import { assertNoSecrets } from '../safety/check.js';

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

/** Creates `.grapher/` with its own .gitignore, refusing a symlinked folder. */
async function outputDir(root: string): Promise<string> {
  const dir = path.join(root, OUTPUT_DIR);
  if (await isSymlink(dir)) throw new Error(`Refusing to write: ${OUTPUT_DIR} is a symlink`);
  await mkdir(dir, { recursive: true });
  await writeNoFollow(path.join(dir, '.gitignore'), '*\n');
  return dir;
}

/**
 * Saves the graph to `<root>/.grapher/graph.json` and returns its path.
 * Refuses to save anything if the graph contains something secret-looking.
 *
 * Refuses to write through symlinks, so a crafted project can't redirect
 * Grapher's output to overwrite a file elsewhere. The folder gets its own
 * .gitignore so output isn't committed by accident.
 */
export async function writeGraph(root: string, graph: Graph): Promise<string> {
  assertNoSecrets(graph);
  const file = path.join(await outputDir(root), 'graph.json');
  await writeNoFollow(file, `${JSON.stringify(graph, null, 2)}\n`);
  return file;
}

/** Saves the viewer page to `<root>/.grapher/index.html` and returns its path. */
export async function writeViewer(root: string, html: string): Promise<string> {
  const file = path.join(await outputDir(root), 'index.html');
  await writeNoFollow(file, html);
  return file;
}

/** Largest file Grapher will read back from its own output folder. */
const MAX_OUTPUT_READ_BYTES = 2 * 1024 * 1024;

/**
 * Reads a file Grapher keeps in `.grapher/`, like the explanation cache.
 * Returns undefined if it doesn't exist. Refuses symlinks and oversized files,
 * since the folder sits inside a project that may not be trusted.
 */
export async function readOutputFile(root: string, name: string): Promise<string | undefined> {
  const dir = path.join(root, OUTPUT_DIR);
  if (await isSymlink(dir)) throw new Error(`Refusing to read: ${OUTPUT_DIR} is a symlink`);
  let handle;
  try {
    handle = await open(path.join(dir, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`Could not read ${OUTPUT_DIR}/${name}`, { cause: error });
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > MAX_OUTPUT_READ_BYTES) {
      throw new Error(`Refusing to read ${OUTPUT_DIR}/${name}: not a regular file or too large`);
    }
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

/** Saves a file into `.grapher/` after checking it for secrets, and returns its path. */
export async function writeOutputFile(
  root: string,
  name: string,
  contents: string,
): Promise<string> {
  assertNoSecrets(contents);
  const file = path.join(await outputDir(root), name);
  await writeNoFollow(file, contents);
  return file;
}

/** Deletes a file from `.grapher/` if it exists. */
export async function removeOutputFile(root: string, name: string): Promise<void> {
  await rm(path.join(root, OUTPUT_DIR, name), { force: true });
}
