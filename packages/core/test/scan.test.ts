import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scanProject } from '../src/index.js';
import { FAKE_SECRET, makeProject, recordingFileSystem, type Tree } from './helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function project(tree: Tree) {
  const created = await makeProject(tree);
  cleanups.push(created.cleanup);
  return created.dir;
}

const filePaths = (result: Awaited<ReturnType<typeof scanProject>>) =>
  result.files.map((file) => file.path);
const reasonOf = (result: Awaited<ReturnType<typeof scanProject>>, p: string) =>
  result.skipped.find((entry) => entry.path === p)?.reason;

describe('scanProject', () => {
  it('lists source files sorted by path', async () => {
    const dir = await project({
      'app/page.tsx': 'export default function Page() {}',
      'app/api/users/route.ts': 'export async function POST() {}',
      'lib/db.ts': 'export const db = {}',
    });

    const result = await scanProject(dir);

    expect(filePaths(result)).toEqual(['app/api/users/route.ts', 'app/page.tsx', 'lib/db.ts']);
    expect(result.files[0]?.size).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  });

  it('never opens secret files, even when .gitignore would re-include them', async () => {
    const dir = await project({
      '.gitignore': '!.env.local\n',
      '.env': `STRIPE_SECRET_KEY=${FAKE_SECRET}`,
      '.env.local': `STRIPE_SECRET_KEY=${FAKE_SECRET}`,
      '.env.example': 'STRIPE_SECRET_KEY=',
      'keys/server.pem': FAKE_SECRET,
      '.ssh/config': FAKE_SECRET,
      'app/page.tsx': 'export default function Page() {}',
    });
    const { fs, reads } = recordingFileSystem();

    const result = await scanProject(dir, {}, fs);

    expect(reasonOf(result, '.env')).toBe('secret-file');
    expect(reasonOf(result, '.env.local')).toBe('secret-file');
    expect(reasonOf(result, 'keys/server.pem')).toBe('secret-file');
    expect(reasonOf(result, '.ssh')).toBe('secret-directory');
    expect(filePaths(result)).toEqual(['.env.example', '.gitignore', 'app/page.tsx']);
    // The only file the scanner may read is .gitignore.
    expect(reads.map((p) => path.basename(p))).toEqual(['.gitignore']);
    expect(JSON.stringify(result)).not.toContain(FAKE_SECRET);
  });

  it('skips dependency and build folders without entering them', async () => {
    const dir = await project({
      'node_modules/react/index.js': '',
      '.next/server/app.js': '',
      'dist/index.js': '',
      'src/index.ts': '',
    });

    const result = await scanProject(dir);

    expect(filePaths(result)).toEqual(['src/index.ts']);
    expect(reasonOf(result, 'node_modules')).toBe('ignored-directory');
    expect(reasonOf(result, '.next')).toBe('ignored-directory');
    expect(result.skipped.some((entry) => entry.path.startsWith('node_modules/'))).toBe(false);
  });

  it('honors root and nested .gitignore files, including negation', async () => {
    const dir = await project({
      '.gitignore': '*.log\ngenerated/\n',
      'debug.log': '',
      'generated/types.ts': '',
      'packages/web/.gitignore': '*.snap\n!keep.log\n',
      'packages/web/a.snap': '',
      'packages/web/keep.log': '',
      'packages/web/index.ts': '',
    });

    const result = await scanProject(dir);

    expect(filePaths(result)).toEqual([
      '.gitignore',
      'packages/web/.gitignore',
      'packages/web/index.ts',
      'packages/web/keep.log',
    ]);
    expect(reasonOf(result, 'debug.log')).toBe('gitignored');
    expect(reasonOf(result, 'generated')).toBe('gitignored');
    expect(reasonOf(result, 'packages/web/a.snap')).toBe('gitignored');
  });

  it('does not follow symlinks, so it cannot be led outside the project', async () => {
    const outside = await project({ 'secret-notes.txt': FAKE_SECRET });
    const dir = await project({
      'src/index.ts': '',
      'src/escape': { symlinkTo: outside },
      'src/notes.txt': { symlinkTo: path.join(outside, 'secret-notes.txt') },
    });

    const result = await scanProject(dir);

    expect(filePaths(result)).toEqual(['src/index.ts']);
    expect(reasonOf(result, 'src/escape')).toBe('symlink');
    expect(reasonOf(result, 'src/notes.txt')).toBe('symlink');
  });

  it('skips files over the size limit', async () => {
    const dir = await project({ 'big.js': 'x'.repeat(2048), 'small.ts': 'ok' });

    const result = await scanProject(dir, { maxFileBytes: 1024 });

    expect(filePaths(result)).toEqual(['small.ts']);
    expect(reasonOf(result, 'big.js')).toBe('too-large');
  });

  it('stops early and says so when the file limit is reached', async () => {
    const dir = await project({ 'a.ts': '', 'b.ts': '', 'c.ts': '' });

    const result = await scanProject(dir, { maxFiles: 2 });

    expect(result.files).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('reports special files without reading them', async () => {
    const dir = await project({ 'src/index.ts': '' });
    const { fs } = recordingFileSystem();
    const withFifo = {
      ...fs,
      async readDir(p: string) {
        const entries = await fs.readDir(p);
        return p === dir ? [...entries, { name: 'pipe', kind: 'other' as const }] : entries;
      },
    };

    const result = await scanProject(dir, {}, withFifo);

    expect(reasonOf(result, 'pipe')).toBe('not-a-file');
  });

  it('resolves a symlinked project root to its real path', async () => {
    const real = await project({ 'index.ts': '' });
    const linkParent = await project({ link: { symlinkTo: real } });

    const result = await scanProject(path.join(linkParent, 'link'));

    expect(filePaths(result)).toEqual(['index.ts']);
  });

  it('explains when the folder does not exist or is a file', async () => {
    const dir = await project({ 'file.ts': '' });
    await mkdir(path.join(dir, 'empty'));
    await writeFile(path.join(dir, 'plain.txt'), '');

    await expect(scanProject(path.join(dir, 'missing'))).rejects.toThrow('Folder not found');
    await expect(scanProject(path.join(dir, 'plain.txt'))).rejects.toThrow('Not a folder');
    await expect(scanProject(path.join(dir, 'empty'))).resolves.toMatchObject({ files: [] });
  });
});
