/** A file the scanner found and that later stages are allowed to read. */
export interface ScannedFile {
  /** Path relative to the project root, with forward slashes. */
  path: string;
  size: number;
}

/**
 * Why something was left out. Secret files are reported by name so the user
 * can see they were protected, but they are never opened.
 */
export type SkipReason =
  | 'secret-file'
  | 'secret-directory'
  | 'ignored-directory'
  | 'gitignored'
  | 'symlink'
  | 'too-large'
  | 'not-a-file';

export interface SkippedEntry {
  path: string;
  reason: SkipReason;
}

export interface ScanResult {
  /** Absolute, symlink-resolved project root. */
  root: string;
  /** Files available for analysis, sorted by path. */
  files: ScannedFile[];
  /** Everything left out, sorted by path. */
  skipped: SkippedEntry[];
  /** True if the scan stopped early because it hit `maxFiles`. */
  truncated: boolean;
}

export interface ScanOptions {
  maxFileBytes?: number;
  maxFiles?: number;
}
