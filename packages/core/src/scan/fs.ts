import { lstat, readFile, readdir, realpath } from 'node:fs/promises';

/** The kinds of directory entry the scanner cares about. */
export type EntryKind = 'file' | 'directory' | 'symlink' | 'other';

export interface DirEntry {
  name: string;
  kind: EntryKind;
}

export interface FileStats {
  kind: EntryKind;
  size: number;
}

/**
 * The only file system operations Grapher performs.
 *
 * Everything goes through this interface so tests can record exactly which
 * paths were read, and prove that secret files are never opened.
 */
export interface FileSystem {
  readDir(path: string): Promise<DirEntry[]>;
  lstat(path: string): Promise<FileStats>;
  readTextFile(path: string): Promise<string>;
  realPath(path: string): Promise<string>;
}

function kindOf(entry: {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): EntryKind {
  if (entry.isSymbolicLink()) return 'symlink';
  if (entry.isFile()) return 'file';
  if (entry.isDirectory()) return 'directory';
  return 'other';
}

export const nodeFileSystem: FileSystem = {
  async readDir(path) {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({ name: entry.name, kind: kindOf(entry) }));
  },
  async lstat(path) {
    const stats = await lstat(path);
    return { kind: kindOf(stats), size: stats.size };
  },
  readTextFile(path) {
    return readFile(path, 'utf8');
  },
  realPath(path) {
    return realpath(path);
  },
};
