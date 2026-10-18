/**
 * Folders skipped in every project: dependencies, build output and caches.
 * None of them contain code the user wrote, and some are huge.
 */
export const DEFAULT_IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
  '.git',
  '.next',
  '.vercel',
  '.turbo',
  '.cache',
  '.output',
  '.grapher',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
]);

/** Larger files are almost always generated or minified, not hand-written source. */
export const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;

/** A safety stop so a mistaken run on a huge folder (like a home directory) ends quickly. */
export const DEFAULT_MAX_FILES = 20_000;
