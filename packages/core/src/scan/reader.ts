import path from 'node:path';

import { DEFAULT_MAX_FILE_BYTES } from './defaults.js';
import { isSecretFile } from './denylist.js';
import { type FileSystem, nodeFileSystem } from './fs.js';
import { isInside } from './paths.js';
import type { ScanResult } from './types.js';

export type ReadRefusal =
  'not-scanned' | 'secret-file' | 'outside-project' | 'symlink' | 'too-large';

export class ReadRefusedError extends Error {
  constructor(
    readonly filePath: string,
    readonly reason: ReadRefusal,
  ) {
    super(`Refused to read ${filePath}: ${reason}`);
    this.name = 'ReadRefusedError';
  }
}

export interface SourceReader {
  read(posixPath: string): Promise<string>;
}

/**
 * The single gate through which later stages read file contents.
 *
 * It only reads files the scanner approved, and re-checks every rule at read
 * time, because a file can change between the scan and the read.
 */
export function createSourceReader(
  scan: ScanResult,
  fs: FileSystem = nodeFileSystem,
  maxFileBytes: number = DEFAULT_MAX_FILE_BYTES,
): SourceReader {
  const approved = new Set(scan.files.map((file) => file.path));

  return {
    async read(posixPath) {
      if (!approved.has(posixPath)) throw new ReadRefusedError(posixPath, 'not-scanned');
      if (isSecretFile(posixPath)) throw new ReadRefusedError(posixPath, 'secret-file');

      const absolute = path.resolve(scan.root, ...posixPath.split('/'));
      if (!isInside(scan.root, absolute)) throw new ReadRefusedError(posixPath, 'outside-project');

      const stats = await fs.lstat(absolute);
      if (stats.kind === 'symlink') throw new ReadRefusedError(posixPath, 'symlink');
      if (stats.size > maxFileBytes) throw new ReadRefusedError(posixPath, 'too-large');

      // A parent folder could have been swapped for a symlink since the scan.
      const real = await fs.realPath(absolute);
      if (!isInside(scan.root, real)) throw new ReadRefusedError(posixPath, 'outside-project');

      return fs.readTextFile(real);
    },
  };
}
