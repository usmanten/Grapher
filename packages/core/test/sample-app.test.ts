import path from 'node:path';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import schema from '../schema/graph.schema.json' with { type: 'json' };
import { analyzeProject } from '../src/index.js';

const SAMPLE_APP = path.resolve(import.meta.dirname, '../../../examples/sample-app');

describe('sample app', async () => {
  const { graph } = await analyzeProject(SAMPLE_APP);
  const label = (from: string, to: string) =>
    graph.connections.find((c) => c.from === `file:${from}` && c.to === to)?.label;

  it('matches graph.schema.json', () => {
    const validate = new Ajv2020({ allErrors: true }).compile(schema);
    expect(validate(graph), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('follows the sign-up flow from page to database and email', () => {
    expect(label('app/signup/page.tsx', 'file:components/SignupForm.tsx')).toBe('displays');
    expect(label('components/SignupForm.tsx', 'file:app/api/users/route.ts')).toBe(
      'sends a POST request to',
    );
    expect(label('app/api/users/route.ts', 'database:postgres')).toBe('reads and saves users');
    expect(label('app/api/users/route.ts', 'file:lib/email.ts')).toBe('uses sendWelcomeEmail');
    expect(label('lib/email.ts', 'service:resend')).toBe('uses Resend');
    expect(label('lib/email.ts', 'setting:RESEND_API_KEY')).toBe('reads setting');
  });

  it('shows a server component reading the database directly', () => {
    expect(label('app/dashboard/page.tsx', 'database:postgres')).toBe('reads from users');
  });

  it('maps server actions, dynamic routes and route groups', () => {
    expect(label('app/posts/new/page.tsx', 'file:app/actions.ts')).toBe('uses createPost');
    expect(label('app/actions.ts', 'database:postgres')).toBe('saves to posts');
    expect(label('components/UserCard.tsx', 'file:app/api/users/[id]/route.ts')).toBe(
      'sends a DELETE request to',
    );
    expect(graph.nodes.find((n) => n.id === 'file:app/(marketing)/about/page.tsx')).toMatchObject({
      urlPath: '/about',
    });
  });

  it('reads the database setting from the Prisma schema', () => {
    expect(label('prisma/schema.prisma', 'setting:DATABASE_URL')).toBe('reads setting');
    expect(graph.nodes.find((n) => n.id === 'database:postgres')).toMatchObject({
      label: 'Postgres',
      via: 'Prisma',
    });
  });

  it('matches the saved snapshot', async () => {
    await expect(`${JSON.stringify(graph, null, 2)}\n`).toMatchFileSnapshot(
      '__snapshots__/sample-app.graph.json',
    );
  });
});
