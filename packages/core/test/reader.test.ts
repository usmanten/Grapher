import { rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createSourceReader,
  ReadRefusedError,
  scanProject,
  type ScanResult,
} from '../src/index.js';
import { FAKE_SECRET, makeProject, type Tree } from './helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function project(tree: Tree) {
  const created = await makeProject(tree);
  cleanups.push(created.cleanup);
  return created.dir;
}

async function refusal(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof ReadRefusedError ? error.reason : `unexpected: ${String(error)}`;
  }
}

describe('createSourceReader', () => {
  it('reads files the scanner approved', async () => {
    const dir = await project({ 'lib/db.ts': 'export const db = 1;' });
    const reader = createSourceReader(await scanProject(dir));

    await expect(reader.read('lib/db.ts')).resolves.toBe('export const db = 1;');
  });

  it('refuses files the scanner did not approve', async () => {
    const dir = await project({ '.env': `KEY=${FAKE_SECRET}`, 'index.ts': '' });
    const reader = createSourceReader(await scanProject(dir));

    expect(await refusal(reader.read('.env'))).toBe('not-scanned');
    expect(await refusal(reader.read('../outside.ts'))).toBe('not-scanned');
  });

  it('refuses secret files and paths outside the project even if a scan result lists them', async () => {
    const dir = await project({ '.env': `KEY=${FAKE_SECRET}`, 'index.ts': '' });
    const tampered: ScanResult = {
      root: dir,
      files: [
        { path: '.env', size: 1 },
        { path: '../escape.ts', size: 1 },
      ],
      skipped: [],
      truncated: false,
    };
    const reader = createSourceReader(tampered);

    expect(await refusal(reader.read('.env'))).toBe('secret-file');
    expect(await refusal(reader.read('../escape.ts'))).toBe('outside-project');
  });

  it('refuses a file replaced by a symlink after the scan', async () => {
    const outside = await project({ 'notes.txt': FAKE_SECRET });
    const dir = await project({ 'notes.ts': 'ok' });
    const reader = createSourceReader(await scanProject(dir));

    await rename(path.join(dir, 'notes.ts'), path.join(dir, 'old.ts'));
    await symlink(path.join(outside, 'notes.txt'), path.join(dir, 'notes.ts'));

    expect(await refusal(reader.read('notes.ts'))).toBe('symlink');
  });

  it('refuses a file whose parent folder became a symlink after the scan', async () => {
    const outside = await project({ 'lib/db.ts': FAKE_SECRET });
    const dir = await project({ 'lib/db.ts': 'ok' });
    const reader = createSourceReader(await scanProject(dir));

    await rename(path.join(dir, 'lib'), path.join(dir, 'lib-old'));
    await symlink(path.join(outside, 'lib'), path.join(dir, 'lib'));

    expect(await refusal(reader.read('lib/db.ts'))).toBe('outside-project');
  });

  it('refuses a file that grew past the size limit after the scan', async () => {
    const dir = await project({ 'data.ts': 'small' });
    const reader = createSourceReader(await scanProject(dir), undefined, 100);

    await writeFile(path.join(dir, 'data.ts'), 'x'.repeat(500));

    expect(await refusal(reader.read('data.ts'))).toBe('too-large');
  });
});
