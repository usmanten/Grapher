import path from 'node:path';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import schema from '../schema/graph.schema.json' with { type: 'json' };
import { analyzeProject } from '../src/index.js';

const PAGES_APP = path.resolve(import.meta.dirname, '../../../examples/pages-app');

describe('pages app', async () => {
  const { graph } = await analyzeProject(PAGES_APP);
  const label = (from: string, to: string) =>
    graph.connections.find((c) => c.from === `file:${from}` && c.to === to)?.label;

  it('matches graph.schema.json and is read as a Pages Router project', () => {
    const validate = new Ajv2020({ allErrors: true }).compile(schema);
    expect(validate(graph), JSON.stringify(validate.errors, null, 2)).toBe(true);
    expect(graph.project.framework).toBe('next-pages-router');
    expect(graph.warnings).toEqual([]);
  });

  it('follows writing a post from page to API route to database', () => {
    expect(label('pages/posts/new.tsx', 'file:pages/api/posts/index.ts')).toBe(
      'sends a POST request to',
    );
    expect(label('pages/api/posts/index.ts', 'database:postgres')).toBe('reads and saves posts');
    expect(label('pages/posts/new.tsx', 'file:pages/index.tsx')).toBe('sends the user to');
  });

  it('maps _app, dynamic pages and getServerSideProps', () => {
    expect(label('pages/_app.tsx', 'file:components/Nav.tsx')).toBe('displays');
    expect(label('pages/index.tsx', 'file:pages/posts/[id].tsx')).toBe('sends the user to');
    expect(label('pages/posts/[id].tsx', 'database:postgres')).toBe('reads from posts');
    expect(graph.nodes.find((n) => n.id === 'file:pages/api/posts/[id].ts')).toMatchObject({
      role: 'route',
      urlPath: '/api/posts/[id]',
      methods: ['DELETE'],
    });
  });
});
