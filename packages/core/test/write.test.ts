import { mkdir, readFile, symlink } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { analyzeProject, writeGraph, writeViewer } from '../src/index.js';
import { makeProject } from './helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('writeGraph', () => {
  it('saves graph.json with a .gitignore so it is not committed', async () => {
    const created = await makeProject({ 'app/page.tsx': 'export default function P() {}' });
    cleanups.push(created.cleanup);
    const { graph, scan } = await analyzeProject(created.dir);

    const file = await writeGraph(scan.root, graph);

    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(graph);
    expect(await readFile(path.join(scan.root, '.grapher/.gitignore'), 'utf8')).toBe('*\n');
  });

  it('refuses to write through a symlinked output folder', async () => {
    const outside = await makeProject({ 'keep.txt': 'x' });
    const created = await makeProject({ 'app/page.tsx': '' });
    cleanups.push(outside.cleanup, created.cleanup);
    await symlink(outside.dir, path.join(created.dir, '.grapher'));
    const { graph, scan } = await analyzeProject(created.dir);

    await expect(writeGraph(scan.root, graph)).rejects.toThrow('symlink');
  });

  it('refuses to write through a symlinked graph.json', async () => {
    const outside = await makeProject({ 'target.json': 'original' });
    const created = await makeProject({ 'app/page.tsx': '' });
    cleanups.push(outside.cleanup, created.cleanup);
    await mkdir(path.join(created.dir, '.grapher'));
    await symlink(
      path.join(outside.dir, 'target.json'),
      path.join(created.dir, '.grapher/graph.json'),
    );
    const { graph, scan } = await analyzeProject(created.dir);

    await expect(writeGraph(scan.root, graph)).rejects.toThrow();
    expect(await readFile(path.join(outside.dir, 'target.json'), 'utf8')).toBe('original');
  });
});

describe('writeViewer', () => {
  it('saves index.html next to graph.json', async () => {
    const created = await makeProject({ 'app/page.tsx': '' });
    cleanups.push(created.cleanup);

    const file = await writeViewer(created.dir, '<p>page</p>');

    expect(file).toBe(path.join(created.dir, '.grapher/index.html'));
    expect(await readFile(file, 'utf8')).toBe('<p>page</p>');
  });

  it('refuses to write through a symlinked index.html', async () => {
    const outside = await makeProject({ 'target.html': 'original' });
    const created = await makeProject({ 'app/page.tsx': '' });
    cleanups.push(outside.cleanup, created.cleanup);
    await mkdir(path.join(created.dir, '.grapher'));
    await symlink(
      path.join(outside.dir, 'target.html'),
      path.join(created.dir, '.grapher/index.html'),
    );

    await expect(writeViewer(created.dir, '<p>new</p>')).rejects.toThrow();
    expect(await readFile(path.join(outside.dir, 'target.html'), 'utf8')).toBe('original');
  });
});
