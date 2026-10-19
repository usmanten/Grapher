import { describe, expect, it } from 'vitest';

import { parseViewerData } from '../src/data.js';

describe('parseViewerData', () => {
  it('rejects data without a graph', () => {
    expect(parseViewerData('__GRAPHER_DATA__')).toBeUndefined();
    expect(parseViewerData({ graph: { nodes: 'x', connections: [] } })).toBeUndefined();
  });

  it('drops malformed nodes and connections to unknown nodes', () => {
    const data = parseViewerData({
      graph: {
        project: { name: 'app' },
        nodes: [
          { id: 'file:a.ts', kind: 'file', path: 'a.ts', role: 'module' },
          { id: 'bad', kind: 'script' },
          null,
        ],
        connections: [
          { id: 'x', from: 'file:a.ts', to: 'missing', kind: 'uses', label: 'uses', locations: [] },
          { id: 'y', from: 'file:a.ts' },
        ],
        warnings: [{ message: 'note' }, 3],
      },
      root: 42,
    });
    expect(data?.graph.nodes.map((n) => n.id)).toEqual(['file:a.ts']);
    expect(data?.graph.connections).toEqual([]);
    expect(data?.graph.warnings).toHaveLength(1);
    expect(data?.root).toBe('');
    expect(data?.protectedFiles).toEqual([]);
  });

  it('keeps known frameworks and drops malformed web routes', () => {
    const data = parseViewerData({
      graph: {
        project: { name: 'api', framework: 'django' },
        nodes: [
          {
            id: 'file:views.py',
            kind: 'file',
            path: 'views.py',
            role: 'route',
            routes: [{ path: '/a/', methods: [] }, { path: 3 }, { path: '/b/', methods: 'GET' }],
          },
        ],
        connections: [],
      },
    });
    expect(data?.graph.project.framework).toBe('django');
    expect(data?.graph.nodes[0]).toMatchObject({ routes: [{ path: '/a/', methods: [] }] });
    const odd = parseViewerData({
      graph: { project: { framework: 'rails' }, nodes: [], connections: [] },
    });
    expect(odd?.graph.project.framework).toBe('unknown');
  });
});
