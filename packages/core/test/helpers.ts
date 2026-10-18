import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type FileSystem, nodeFileSystem } from '../src/index.js';

/**
 * A fake secret value. It is assembled at runtime so no key-shaped string is
 * ever committed, which would trip GitHub push protection and secret scanners.
 */
export const FAKE_SECRET = ['sk', 'live', 'FAKE0nlyForGrapherTests', 'x9Q2'].join('_');

export type Tree = Record<string, string | { symlinkTo: string }>;

/** Creates a temporary project from a map of relative paths to contents. */
export async function makeProject(
  tree: Tree,
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'grapher-test-'));
  for (const [relPath, content] of Object.entries(tree)) {
    const target = path.join(dir, ...relPath.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    if (typeof content === 'string') await writeFile(target, content);
    else await symlink(content.symlinkTo, target);
  }
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Wraps the real file system and records every file whose contents were read. */
export function recordingFileSystem(): { fs: FileSystem; reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    fs: {
      ...nodeFileSystem,
      readTextFile(p) {
        reads.push(p);
        return nodeFileSystem.readTextFile(p);
      },
    },
  };
}
