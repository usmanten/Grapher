import path from 'node:path';

import {
  DEFAULT_IGNORED_DIRECTORIES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_FILES,
} from './defaults.js';
import { isSecretDirectory, isSecretFile } from './denylist.js';
import { type FileSystem, nodeFileSystem } from './fs.js';
import { type IgnoreLayer, isGitignored, parseGitignore } from './gitignore.js';
import type { ScanOptions, ScanResult, ScannedFile, SkippedEntry } from './types.js';

class FileLimitReached extends Error {}

/**
 * Walks a project and decides which files later stages may read.
 *
 * The scanner only lists directories and reads .gitignore files. It never
 * opens any other file, and it never follows symlinks, so it cannot be led
 * outside the project.
 */
export async function scanProject(
  projectDir: string,
  options: ScanOptions = {},
  fs: FileSystem = nodeFileSystem,
): Promise<ScanResult> {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;

  let root: string;
  try {
    root = await fs.realPath(path.resolve(projectDir));
  } catch {
    throw new Error(`Folder not found: ${projectDir}`);
  }
  if ((await fs.lstat(root)).kind !== 'directory') {
    throw new Error(`Not a folder: ${projectDir}`);
  }

  const files: ScannedFile[] = [];
  const skipped: SkippedEntry[] = [];

  async function walk(relDir: string, layers: readonly IgnoreLayer[]): Promise<void> {
    const absDir = path.join(root, relDir);
    const entries = (await fs.readDir(absDir)).sort((a, b) => a.name.localeCompare(b.name));

    // .gitignore is the one file the scanner reads. Never read it if it is a symlink.
    const gitignore = entries.find((e) => e.name === '.gitignore' && e.kind === 'file');
    const activeLayers = gitignore
      ? [...layers, parseGitignore(relDir, await fs.readTextFile(path.join(absDir, '.gitignore')))]
      : layers;

    for (const entry of entries) {
      const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`;

      if (entry.kind === 'symlink') {
        skipped.push({ path: relPath, reason: 'symlink' });
        continue;
      }

      if (entry.kind === 'directory') {
        if (isSecretDirectory(relPath)) {
          skipped.push({ path: relPath, reason: 'secret-directory' });
        } else if (DEFAULT_IGNORED_DIRECTORIES.has(entry.name)) {
          skipped.push({ path: relPath, reason: 'ignored-directory' });
        } else if (isGitignored(activeLayers, relPath, true)) {
          skipped.push({ path: relPath, reason: 'gitignored' });
        } else {
          await walk(relPath, activeLayers);
        }
        continue;
      }

      if (entry.kind !== 'file') {
        skipped.push({ path: relPath, reason: 'not-a-file' });
        continue;
      }

      // Checked before .gitignore so a secret file is reported as protected
      // even when a negation rule would re-include it.
      if (isSecretFile(relPath)) {
        skipped.push({ path: relPath, reason: 'secret-file' });
        continue;
      }
      if (isGitignored(activeLayers, relPath, false)) {
        skipped.push({ path: relPath, reason: 'gitignored' });
        continue;
      }

      const { size } = await fs.lstat(path.join(root, relPath));
      if (size > maxFileBytes) {
        skipped.push({ path: relPath, reason: 'too-large' });
        continue;
      }

      if (files.length >= maxFiles) throw new FileLimitReached();
      files.push({ path: relPath, size });
    }
  }

  let truncated = false;
  try {
    await walk('', []);
  } catch (error) {
    if (!(error instanceof FileLimitReached)) throw error;
    truncated = true;
  }

  const byPath = (a: { path: string }, b: { path: string }) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  return { root, files: files.sort(byPath), skipped: skipped.sort(byPath), truncated };
}
