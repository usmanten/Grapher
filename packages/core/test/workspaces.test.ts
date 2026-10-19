import { describe, expect, it } from 'vitest';

import { type WorkspacePackage, workspaces } from '../src/analyze/packs/javascript/workspaces.js';

const pkg = (dir: string, manifest: Record<string, unknown>): WorkspacePackage => ({
  name: typeof manifest.name === 'string' ? manifest.name : '',
  dir,
  manifest,
});

function lookup(packages: WorkspacePackage[], files: string[]) {
  const set = new Set(files);
  return workspaces(packages, (path) => set.has(path));
}

describe('workspaces', () => {
  it('reads the common ways a package.json names its entry file', () => {
    const ws = lookup(
      [
        pkg('a', { name: 'a', exports: './dist/index.mjs' }),
        pkg('b', { name: 'b', exports: { import: './build/main.js' } }),
        pkg('c', { name: 'c', exports: { '.': [{ require: './lib/c.cjs' }] } }),
        pkg('d', { name: 'd', typings: 'out/d.d.ts' }),
        pkg('e', { name: 'e' }),
      ],
      ['a/src/index.ts', 'b/src/main.tsx', 'c/src/c.ts', 'd/src/d.ts', 'e/index.js'],
    );
    expect(ws.resolve('a')).toBe('a/src/index.ts');
    expect(ws.resolve('b')).toBe('b/src/main.tsx');
    expect(ws.resolve('c')).toBe('c/src/c.ts');
    expect(ws.resolve('d')).toBe('d/src/d.ts');
    expect(ws.resolve('e')).toBe('e/index.js');
    expect(ws.compilerPaths()).toEqual({
      a: ['/a/src/index.ts'],
      b: ['/b/src/main.tsx'],
      c: ['/c/src/c.ts'],
      d: ['/d/src/d.ts'],
      e: ['/e/index.js'],
    });
  });

  it('resolves subpaths through exports, folders and src/', () => {
    const ws = lookup(
      [
        pkg('packages/ui', {
          name: '@acme/ui',
          exports: { '.': './src/index.ts', './icons/*': './src/icons/*.tsx', './theme': null },
        }),
        pkg('packages/utils', { name: '@acme/utils' }),
      ],
      [
        'packages/ui/src/index.ts',
        'packages/ui/src/icons/star.tsx',
        'packages/utils/src/format/index.ts',
      ],
    );
    expect(ws.resolve('@acme/ui/icons/star')).toBe('packages/ui/src/icons/star.tsx');
    expect(ws.resolve('@acme/ui/theme')).toBeUndefined();
    expect(ws.resolve('@acme/utils/format')).toBe('packages/utils/src/format/index.ts');
    expect(ws.resolve('@acme/other')).toBeUndefined();
  });

  it('collects dependencies from every package.json, named or not', () => {
    const ws = lookup(
      [
        pkg('', { dependencies: { next: '1' } }),
        pkg('apps/web', { name: 'web', devDependencies: { vitest: '1' } }),
      ],
      [],
    );
    expect([...ws.dependencies].sort()).toEqual(['next', 'vitest']);
  });
});
