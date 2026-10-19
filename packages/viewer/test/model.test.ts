import { readFileSync } from 'node:fs';

import type { Connection, FileNode, Graph } from '@grapher/core';
import { describe, expect, it } from 'vitest';

import {
  connectionFor,
  defaultFocus,
  describeConnection,
  describeNode,
  editorLink,
  fileTree,
  indexGraph,
  isEntryPoint,
  kindGroup,
  layoutFor,
  rankColumns,
  shortName,
  shortPaths,
  unusedFiles,
  usedByCopy,
} from '../src/model.js';

// The sample app graph from the core snapshot test keeps these tests realistic.
const graph = JSON.parse(
  readFileSync(
    new URL('../../core/test/__snapshots__/sample-app.graph.json', import.meta.url),
    'utf8',
  ),
) as Graph;
const index = indexGraph(graph);

describe('layoutFor', () => {
  it('puts a file that goes both ways on both sides, so every line runs left to right', () => {
    const at = [{ path: 'x', line: 1, role: 'use' as const }];
    const twoWay = indexGraph({
      ...graph,
      nodes: [
        { id: 'file:app/page.tsx', kind: 'file', path: 'app/page.tsx', role: 'page', urlPath: '/' },
        { id: 'file:footer.tsx', kind: 'file', path: 'footer.tsx', role: 'component' },
      ],
      connections: [
        {
          id: 'p->f',
          from: 'file:app/page.tsx',
          to: 'file:footer.tsx',
          kind: 'displays',
          label: 'displays',
          locations: at,
        },
        {
          id: 'f->p',
          from: 'file:footer.tsx',
          to: 'file:app/page.tsx',
          kind: 'links',
          label: 'sends the user to',
          locations: at,
        },
      ],
    });
    const layout = layoutFor(twoWay, 'file', 'file:app/page.tsx');
    const copy = usedByCopy('file:footer.tsx');
    expect(layout.columns.map((c) => c.nodes)).toEqual([
      [copy],
      ['file:app/page.tsx'],
      ['file:footer.tsx'],
    ]);
    expect(layout.copies).toEqual({ [copy]: 'file:footer.tsx' });
    expect(layout.ends).toEqual({ 'f->p': { from: copy, to: 'file:app/page.tsx' } });
  });

  it('shows what uses a file on the left and what it uses on the right', () => {
    const layout = layoutFor(index, 'file', 'file:app/api/users/route.ts');
    expect(layout.columns.map((c) => c.heading)).toEqual([
      'Used by',
      'Selected file',
      'Uses and talks to',
    ]);
    expect(layout.columns[0]?.nodes).toContain('file:components/SignupForm.tsx');
    expect(layout.columns[2]?.nodes).toContain('file:lib/db.ts');
    expect(
      layout.connections.every(
        (c) => c.from === 'file:app/api/users/route.ts' || c.to === 'file:app/api/users/route.ts',
      ),
    ).toBe(true);
    expect(layout.labels).toBe(true);
  });

  it('traces the full flow upstream and downstream', () => {
    const layout = layoutFor(index, 'flow', 'file:components/SignupForm.tsx');
    const shown = layout.columns.flatMap((c) => c.nodes);
    expect(shown).toContain('file:app/signup/page.tsx');
    expect(shown).toContain('file:app/api/users/route.ts');
    expect(shown).toContain('database:postgres');
    expect(shown).not.toContain('file:components/CheckoutButton.tsx');
  });

  it('shows everything without labels in the overview', () => {
    const layout = layoutFor(index, 'overview', undefined);
    expect(layout.columns.flatMap((c) => c.nodes)).toHaveLength(graph.nodes.length);
    expect(layout.connections).toHaveLength(graph.connections.length);
    expect(layout.labels).toBe(false);
  });

  it('falls back to the overview when the focus is unknown', () => {
    expect(layoutFor(index, 'file', 'file:nope.ts').title).toBe('Overview');
  });
});

function conn(from: string, to: string): Connection {
  return { id: `${from}->${to}`, from, to, kind: 'uses', label: 'uses', locations: [] };
}

describe('rankColumns', () => {
  it('places each node after everything that points to it', () => {
    const columns = rankColumns(new Set(['a', 'b', 'c']), [
      conn('a', 'b'),
      conn('b', 'c'),
      conn('a', 'c'),
    ]);
    expect(columns).toEqual([['a'], ['b'], ['c']]);
  });

  it('terminates on cycles', () => {
    const columns = rankColumns(new Set(['a', 'b']), [conn('a', 'b'), conn('b', 'a')]);
    expect(columns.flat().sort()).toEqual(['a', 'b']);
  });
});

describe('focus and selection', () => {
  it('starts on the home page', () => {
    expect(defaultFocus(graph)).toBe('file:app/page.tsx');
  });

  it('keeps the selected connection when it still touches the new focus', () => {
    const id = 'file:components/SignupForm.tsx->file:app/api/users/route.ts';
    expect(connectionFor(index, 'file:app/api/users/route.ts', id)).toBe(id);
    expect(connectionFor(index, 'file:lib/db.ts', id)).not.toBe(id);
  });
});

describe('text', () => {
  it('describes nodes and connections in plain words', () => {
    const route = index.nodes.get('file:app/api/users/route.ts');
    expect(route && describeNode(route)).toBe('API route: GET, POST /api/users');
    const setting = graph.nodes.find((n) => n.kind === 'setting' && !n.public);
    expect(setting && describeNode(setting)).toBe('Setting, value hidden');
    const request = index.connections.get(
      'file:components/SignupForm.tsx->file:app/api/users/route.ts',
    );
    expect(request && describeConnection(index, request)).toContain('(/api/users)');
  });

  it('marks packages identified by AI, and gray boxes for unidentified ones', () => {
    const files: Graph['nodes'] = [{ id: 'file:a.ts', kind: 'file', path: 'a.ts', role: 'module' }];
    const nodes: Graph['nodes'] = [
      ...files,
      { id: 'service:x', kind: 'service', label: 'X', source: 'x', identifiedBy: 'ai' },
      { id: 'service:y', kind: 'service', label: 'y', source: 'y', unidentified: true },
      { id: 'database:z', kind: 'database', label: 'Z', via: 'z', identifiedBy: 'ai' },
    ];
    const small = indexGraph({
      ...graph,
      nodes,
      connections: [
        {
          id: 'file:a.ts->service:y',
          from: 'file:a.ts',
          to: 'service:y',
          kind: 'uses-service',
          label: 'uses the y package',
          locations: [{ path: 'a.ts', line: 1, role: 'import' }],
        },
      ],
    });
    const [, x, y, z] = nodes;
    expect(x && describeNode(x)).toBe('Outside service, identified by AI');
    expect(y && describeNode(y)).toBe('Package, not yet identified');
    expect(y && kindGroup(y)).toBe('package');
    expect(z && describeNode(z)).toBe('Database, used through z, identified by AI');
    const c = small.connections.get('file:a.ts->service:y');
    expect(c && describeConnection(small, c)).toContain("doesn't know yet");
  });

  it('groups nodes by color kind', () => {
    expect(graph.nodes.map(kindGroup)).not.toContain(undefined);
  });
});

describe('shortPaths', () => {
  const files = (...paths: string[]): Graph => ({
    ...graph,
    nodes: paths.map((path) => ({ id: `file:${path}`, kind: 'file', path, role: 'module' })),
    connections: [],
  });

  it('adds folders only until files with the same name can be told apart', () => {
    const names = shortPaths(
      files(
        'packages/cli/src/main.ts',
        'packages/core/src/main.ts',
        'packages/core/src/analyze/builder.ts',
        'main.ts',
      ),
    );
    expect(names.get('file:packages/cli/src/main.ts')).toBe('cli/src/main.ts');
    expect(names.get('file:packages/core/src/main.ts')).toBe('core/src/main.ts');
    expect(names.get('file:packages/core/src/analyze/builder.ts')).toBe('analyze/builder.ts');
    expect(names.get('file:main.ts')).toBe('main.ts');
  });

  it('keeps a whole path when another file ends with it', () => {
    const names = shortPaths(files('lib/db.ts', 'apps/web/lib/db.ts'));
    expect(names.get('file:lib/db.ts')).toBe('lib/db.ts');
    expect(names.get('file:apps/web/lib/db.ts')).toBe('web/lib/db.ts');
  });

  it('is what sentences and headings use', () => {
    const small = indexGraph(files('apps/a/src/main.ts', 'apps/b/src/main.ts'));
    const node = small.nodes.get('file:apps/a/src/main.ts');
    expect(node && shortName(small, node)).toBe('a/src/main.ts');
  });
});

describe('fileTree', () => {
  it('nests files under their folders', () => {
    const tree = fileTree(graph);
    const app = tree.folders.find((f) => f.name === 'app');
    expect(app?.files.map((f) => f.name)).toContain('page.tsx');
    expect(app?.folders.map((f) => f.name)).toContain('api');
  });
});

describe('editorLink', () => {
  it('builds a VS Code link to the line', () => {
    expect(editorLink('/home/you/app', 'app/page.tsx', 3)).toBe(
      'vscode://file/home/you/app/app/page.tsx:3',
    );
  });

  it('encodes each part so a file name cannot change the link', () => {
    const link = editorLink('/p', 'app/[id]/a b?x=1#y.ts', 1);
    expect(link).toBe('vscode://file/p/app/%5Bid%5D/a%20b%3Fx%3D1%23y.ts:1');
  });

  it('handles Windows folders', () => {
    expect(editorLink('C:\\Users\\you\\app', 'page.tsx', 2)).toBe(
      'vscode://file/C:/Users/you/app/page.tsx:2',
    );
  });
});

describe('unused files', () => {
  const file = (path: string, role: FileNode['role'] = 'component'): FileNode => ({
    id: `file:${path}`,
    kind: 'file',
    path,
    role,
  });

  it('finds nothing unused in the sample app', () => {
    expect([...unusedFiles(graph)]).toEqual([]);
  });

  it('marks a file that nothing uses, but not one that something uses', () => {
    const nodes = [
      file('app/page.tsx', 'page'),
      file('components/Nav.tsx'),
      file('components/OldBanner.tsx'),
      file('lib/helpers.ts', 'module'),
    ];
    const unused = unusedFiles({
      ...graph,
      nodes,
      connections: [
        conn('file:app/page.tsx', 'file:components/Nav.tsx'),
        // A file that only uses itself is still unused.
        conn('file:lib/helpers.ts', 'file:lib/helpers.ts'),
      ],
    });
    expect([...unused].sort()).toEqual(['file:components/OldBanner.tsx', 'file:lib/helpers.ts']);
  });

  it('only counts files, never databases, services or settings', () => {
    const unused = unusedFiles({
      ...graph,
      nodes: [{ id: 'setting:API_KEY', kind: 'setting', name: 'API_KEY', public: false }],
      connections: [],
    });
    expect(unused.size).toBe(0);
  });

  it('never grays out files that are started from outside the code', () => {
    const entries = [
      file('app/page.tsx', 'page'),
      file('app/layout.tsx', 'layout'),
      file('app/api/users/route.ts', 'route'),
      file('middleware.ts', 'middleware'),
      file('next.config.ts', 'config'),
      file('app/loading.tsx'),
      file('src/app/blog/[slug]/not-found.tsx'),
      file('app/global-error.tsx'),
      file('app/sitemap.ts', 'module'),
      file('app/opengraph-image.tsx'),
      file('index.ts', 'module'),
      file('src/main.ts', 'module'),
      file('packages/cli/src/index.ts', 'module'),
      file('scripts/backfill.ts', 'module'),
      file('prisma/seed.ts', 'module'),
      file('tests/helpers.ts', 'module'),
      file('components/Button.stories.tsx'),
      file('public/analytics.js', 'module'),
      file('static/js/chart.min.js', 'module'),
      // Other languages only get a basic map, so they are never marked.
      file('src/main/java/com/shop/OrderController.java', 'module'),
      file('cmd/api/routes.go', 'module'),
      file('app/views.py', 'module'),
    ];
    for (const entry of entries) expect(isEntryPoint(entry), entry.path).toBe(true);
    expect(unusedFiles({ ...graph, nodes: entries, connections: [] }).size).toBe(0);
  });

  it('still grays out look-alikes that nothing starts', () => {
    const lookAlikes = [
      file('components/ui/index.ts', 'module'),
      file('components/loading.tsx'),
      file('lib/server.ts', 'module'),
      file('app/actions.ts', 'server-actions'),
    ];
    for (const node of lookAlikes) expect(isEntryPoint(node), node.path).toBe(false);
  });

  it('says so in the file view', () => {
    const lonely = indexGraph({
      ...graph,
      nodes: [file('components/OldBanner.tsx')],
      connections: [],
    });
    expect(lonely.unused.has('file:components/OldBanner.tsx')).toBe(true);
    expect(layoutFor(lonely, 'file', 'file:components/OldBanner.tsx').subtitle).toBe(
      'Component. Nothing in your code uses this file.',
    );
  });
});
