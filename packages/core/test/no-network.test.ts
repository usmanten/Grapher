import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Grapher promises that it never sends code anywhere. This test fails if any
 * source file starts using a networking API.
 */
const PACKAGES_DIR = path.resolve(import.meta.dirname, '../..');
const FORBIDDEN = [
  /from ['"](node:)?(http|https|http2|net|tls|dgram|dns)['"]/,
  /import\(['"](node:)?(http|https|http2|net|tls|dgram|dns)['"]\)/,
  /require\(['"](node:)?(http|https|http2|net|tls|dgram|dns)['"]\)/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
];

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => file.includes(`${path.sep}src${path.sep}`) && !file.includes('node_modules'));
}

describe('network guard', () => {
  it('finds source files to check', async () => {
    expect((await sourceFiles(PACKAGES_DIR)).length).toBeGreaterThan(0);
  });

  it('no package source uses a networking API', async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(PACKAGES_DIR)) {
      const text = await readFile(file, 'utf8');
      if (FORBIDDEN.some((pattern) => pattern.test(text)))
        offenders.push(path.relative(PACKAGES_DIR, file));
    }
    expect(offenders).toEqual([]);
  });
});
