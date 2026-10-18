import { describe, expect, it } from 'vitest';

import {
  GRAPH_SCHEMA_VERSION,
  renderViewer,
  scriptSafeJson,
  type ViewerData,
} from '../src/index.js';

const data = (name: string): ViewerData => ({
  graph: {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    project: { name, framework: 'next-app-router' },
    nodes: [],
    connections: [],
    unknownPackages: [],
    warnings: [],
  },
  root: '/home/you/app',
  protectedFiles: ['.env'],
  explanations: {},
});

const TEMPLATE = '<script type="application/json" id="d">"__GRAPHER_DATA__"</script><p>after</p>';

describe('scriptSafeJson', () => {
  it('escapes characters that could end a script element or start HTML', () => {
    const json = scriptSafeJson({
      a: '</script><img src=x onerror=alert(1)>',
      b: '<!--',
      c: '&amp;',
    });
    expect(json).not.toMatch(/[<>&]/);
    expect(JSON.parse(json)).toEqual({
      a: '</script><img src=x onerror=alert(1)>',
      b: '<!--',
      c: '&amp;',
    });
  });

  it('escapes line and paragraph separators', () => {
    const json = scriptSafeJson('a\u2028b\u2029c');
    expect(json).toBe('"a\\u2028b\\u2029c"');
    expect(JSON.parse(json)).toBe('a\u2028b\u2029c');
  });
});

describe('renderViewer', () => {
  it('puts the data in place of the placeholder and nowhere else', () => {
    const page = renderViewer(TEMPLATE, data('</script><script>alert(1)</script>'));
    expect(page.match(/<\/script>/g)).toHaveLength(1);
    expect(page.endsWith('</script><p>after</p>')).toBe(true);
    const json = /id="d">(.*)<\/script>/.exec(page)?.[1] ?? '';
    expect((JSON.parse(json) as ViewerData).graph.project.name).toBe(
      '</script><script>alert(1)</script>',
    );
  });

  it('treats $ patterns in the data as plain text', () => {
    const page = renderViewer(TEMPLATE, data("$$ $' $` $1"));
    expect(page).toContain("$$ $' $` $1");
  });

  it('refuses a template without exactly one placeholder', () => {
    expect(() => renderViewer('<p></p>', data('x'))).toThrow('exactly once');
    expect(() => renderViewer(TEMPLATE + TEMPLATE, data('x'))).toThrow('exactly once');
  });
});
