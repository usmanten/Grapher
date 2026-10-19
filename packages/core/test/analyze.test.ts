import { afterEach, describe, expect, it } from 'vitest';

import { analyzeProject, type Connection, type FileNode, type Graph } from '../src/index.js';
import { FAKE_SECRET, makeProject, type Tree } from './helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const TSCONFIG = JSON.stringify({ compilerOptions: { paths: { '@/*': ['./*'] } } });

async function graphOf(tree: Tree): Promise<Graph> {
  const created = await makeProject({ 'tsconfig.json': TSCONFIG, ...tree });
  cleanups.push(created.cleanup);
  return (await analyzeProject(created.dir)).graph;
}

function connection(graph: Graph, from: string, to: string): Connection | undefined {
  return graph.connections.find((c) => c.from === from && c.to === to);
}

describe('imports', () => {
  it('labels a connection by the imported names a file actually uses', async () => {
    const graph = await graphOf({
      'lib/math.ts': 'export const add = 1; export const sub = 2; export const mul = 3;',
      'app/page.tsx': "import { add, sub, mul as times } from '@/lib/math';\nadd; sub; times;",
    });
    expect(connection(graph, 'file:app/page.tsx', 'file:lib/math.ts')?.label).toBe(
      'uses add, sub and 1 more',
    );
  });

  it('flags imports that are never used, and ignores type-only imports', async () => {
    const graph = await graphOf({
      'lib/a.ts': 'export const a = 1; export type T = string;',
      'lib/b.ts': 'export interface B { x: number }',
      'app/page.tsx': [
        "import { a } from '../lib/a';",
        "import type { B } from '../lib/b';",
        "import { type T } from '../lib/a';",
        'export const x: B | T | undefined = undefined;',
      ].join('\n'),
    });
    expect(connection(graph, 'file:app/page.tsx', 'file:lib/a.ts')?.label).toBe(
      'imports but never uses',
    );
    expect(connection(graph, 'file:app/page.tsx', 'file:lib/b.ts')).toBeUndefined();
  });

  it('does not count a property with the same name as a use', async () => {
    const graph = await graphOf({
      'lib/a.ts': 'export const user = 1;',
      'app/page.tsx': "import { user } from '../lib/a';\nconst o = { user: 2 };\no.user;",
    });
    expect(connection(graph, 'file:app/page.tsx', 'file:lib/a.ts')?.label).toBe(
      'imports but never uses',
    );
  });

  it('follows re-exports, side-effect imports and dynamic imports', async () => {
    const graph = await graphOf({
      'lib/a.ts': 'export const a = 1;',
      'lib/setup.ts': 'globalThis.ready = true;',
      'lib/heavy.ts': 'export default 1;',
      'lib/index.ts': "export * from './a';",
      'app/page.tsx':
        "import '../lib/setup';\nexport async function load() { return import('../lib/heavy'); }",
    });
    expect(connection(graph, 'file:lib/index.ts', 'file:lib/a.ts')?.label).toBe('uses re-exports');
    expect(connection(graph, 'file:app/page.tsx', 'file:lib/setup.ts')?.label).toBe('uses it');
    expect(connection(graph, 'file:app/page.tsx', 'file:lib/heavy.ts')?.label).toBe('uses it');
  });

  it('works without a tsconfig, using relative imports', async () => {
    const created = await makeProject({
      'lib/a.js': 'export const a = 1;',
      'app/page.jsx': "import { a } from '../lib/a';\nexport default () => a;",
    });
    cleanups.push(created.cleanup);
    const { graph } = await analyzeProject(created.dir);
    expect(connection(graph, 'file:app/page.jsx', 'file:lib/a.js')?.label).toBe('uses a');
  });

  it('reads path aliases from jsconfig.json too', async () => {
    const created = await makeProject({
      'jsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '~/*': ['src/*'] } },
      }),
      'src/a.js': 'export const a = 1;',
      'app/page.jsx': "import { a } from '~/a';\nexport default () => a;",
    });
    cleanups.push(created.cleanup);
    const { graph } = await analyzeProject(created.dir);
    expect(connection(graph, 'file:app/page.jsx', 'file:src/a.js')).toBeDefined();
  });
});

describe('requests', () => {
  const routes: Tree = {
    'app/api/users/route.ts': 'export async function GET() {}\nexport async function POST() {}',
    'app/api/users/[id]/route.ts': 'export async function DELETE() {}',
    'app/api/users/me/route.ts': 'export const GET = async () => {};',
  };

  it('links fetch and axios calls to the API route they reach, with the method', async () => {
    const graph = await graphOf({
      ...routes,
      'components/A.tsx': [
        "fetch('/api/users');",
        "fetch('/api/users?page=2', { method: 'post' });",
        'fetch(`/api/users/${id}`, { method: "DELETE" });',
        "fetch('/api/users/me');",
        'fetch(`${base}/api/users`);',
        "axios.post('/api/users');",
        "fetch('http://localhost:3000/api/users/me');",
        "fetch('/api/missing');",
        'fetch(someVariable);',
      ].join('\n'),
    });
    const from = 'file:components/A.tsx';
    expect(connection(graph, from, 'file:app/api/users/route.ts')).toMatchObject({
      label: 'sends GET and POST requests to',
      details: ['GET', 'POST'],
    });
    expect(connection(graph, from, 'file:app/api/users/[id]/route.ts')?.label).toBe(
      'sends a DELETE request to',
    );
    expect(connection(graph, from, 'file:app/api/users/me/route.ts')?.label).toBe(
      'sends a GET request to',
    );
    const node = graph.nodes.find((n) => n.id === 'file:app/api/users/route.ts');
    expect(node).toMatchObject({ urlPath: '/api/users', methods: ['GET', 'POST'] });
  });

  it('records outside web services by host only', async () => {
    const graph = await graphOf({
      'lib/weather.ts': `fetch('https://api.weather.example/v1?key=${FAKE_SECRET}');`,
    });
    expect(graph.nodes).toContainEqual({
      id: 'service:api.weather.example',
      kind: 'service',
      label: 'api.weather.example',
      source: 'api.weather.example',
    });
    expect(JSON.stringify(graph)).not.toContain(FAKE_SECRET);
  });

  it('leaves out logins written into a URL', async () => {
    const graph = await graphOf({
      'lib/a.ts': `fetch('https://${FAKE_SECRET}@api.one.example/data');`,
      'lib/b.ts': `fetch('https://admin:${FAKE_SECRET}@api.two.example:8443/data');`,
    });
    const services = graph.nodes.filter((n) => n.kind === 'service').map((n) => n.id);
    expect(services).toEqual(['service:api.one.example', 'service:api.two.example']);
    expect(JSON.stringify(graph)).not.toContain(FAKE_SECRET);
    expect(JSON.stringify(graph)).not.toContain('admin');
  });
});

describe('packages', () => {
  it('turns known packages into services and databases, and lists unknown ones by name', async () => {
    const graph = await graphOf({
      'lib/ai.ts': "import OpenAI from 'openai';\nexport const client = new OpenAI();",
      'lib/cache.ts': "import { Redis } from '@upstash/redis';\nexport const r = Redis;",
      'lib/misc.ts':
        "import { z } from 'zod';\nimport left from 'left-pad-pro';\nimport fs from 'node:fs';\nimport path from 'path';\nimport { gone } from '@/lib/missing';\nimport x from '#internal';\nz; left; fs; path; gone; x;",
    });
    expect(connection(graph, 'file:lib/ai.ts', 'service:openai')?.label).toBe('uses OpenAI');
    expect(connection(graph, 'file:lib/cache.ts', 'database:redis')?.label).toBe('connects to');
    expect(graph.nodes.find((n) => n.id === 'database:redis')).toMatchObject({ inferred: true });
    expect(graph.unknownPackages).toEqual(['left-pad-pro']);
  });

  it('leaves out build tools that only config files import, and test files', async () => {
    const graph = await graphOf({
      'vitest.config.ts':
        "import { defineConfig } from 'vitest/config';\nexport default defineConfig({});",
      'lib/ship.ts': "import { Shippo } from 'shippo';\nexport const s = new Shippo({});",
      'lib/ship.test.ts':
        "import { s } from './ship';\nimport { it } from 'vitest';\nit('x', () => s);",
      'lib/__tests__/more.ts': "import { s } from '../ship';\ns;",
    });
    expect(graph.unknownPackages).toEqual([]);
    expect(connection(graph, 'file:lib/ship.ts', 'service:shippo')?.label).toBe('uses Shippo');
    const paths = graph.nodes.flatMap((n) => (n.kind === 'file' ? [n.path] : []));
    expect(paths).toEqual(['lib/ship.ts', 'vitest.config.ts']);
  });
});

describe('navigation', () => {
  it('connects links, redirects and checkout return addresses to the pages they open', async () => {
    const graph = await graphOf({
      'app/page.tsx': 'export default function Home() { return null; }',
      'app/about/page.tsx': 'export default function About() { return null; }',
      'app/shop/[slug]/page.tsx': 'export default function Item() { return null; }',
      'app/checkout/done/page.tsx': 'export default function Done() { return null; }',
      'app/api/buy/route.ts': [
        'export async function POST() {',
        '  const base = process.env.BASE;',
        '  return { success_url: `${base}/checkout/done?order=1`, cancelUrl: "https://elsewhere.example/x" };',
        '}',
      ].join('\n'),
      'components/nav.tsx': [
        "import Link from 'next/link';",
        "const items = [{ name: 'About', href: '/about' }];",
        'export function Nav({ slug }: { slug: string }) {',
        '  return <><Link href="/">Home</Link><Link href={`/shop/${slug}`}>Item</Link>{items.length}<a href="/api/buy">Buy</a></>;',
        '}',
      ].join('\n'),
      'app/actions.ts': [
        "'use server';",
        "import { redirect } from 'next/navigation';",
        "export async function go() { redirect('/about'); }",
      ].join('\n'),
      'components/back.tsx': [
        "'use client';",
        "import { useRouter } from 'next/navigation';",
        "export function Back() { const router = useRouter(); return <button onClick={() => router.push('/')} />; }",
      ].join('\n'),
      'app/sitemap.ts': "export default function sitemap() { return [{ url: '/about' }]; }",
    });
    const links = graph.connections
      .filter((c) => c.kind === 'links')
      .map((c) => `${c.from} -> ${c.to}`);
    expect(links).toEqual([
      'file:app/actions.ts -> file:app/about/page.tsx',
      'file:app/api/buy/route.ts -> file:app/checkout/done/page.tsx',
      'file:components/back.tsx -> file:app/page.tsx',
      'file:components/nav.tsx -> file:app/about/page.tsx',
      'file:components/nav.tsx -> file:app/page.tsx',
      'file:components/nav.tsx -> file:app/shop/[slug]/page.tsx',
    ]);
    expect(connection(graph, 'file:components/back.tsx', 'file:app/page.tsx')?.label).toBe(
      'sends the user to',
    );
  });
});

describe('settings', () => {
  it('records setting names from every common pattern, never values', async () => {
    const graph = await graphOf({
      '.env': `API_KEY=${FAKE_SECRET}`,
      'lib/config.ts': [
        'export const a = process.env.API_KEY;',
        "export const b = process.env['OTHER_KEY'];",
        'const { THIRD_KEY, FOURTH: renamed } = process.env;',
        'export const c = process.env.NODE_ENV;',
        'export const d = process.env.NEXT_PUBLIC_URL;',
        'export { THIRD_KEY, renamed };',
      ].join('\n'),
    });
    const settings = graph.nodes.filter((n) => n.kind === 'setting');
    expect(settings.map((n) => n.id)).toEqual([
      'setting:API_KEY',
      'setting:FOURTH',
      'setting:NEXT_PUBLIC_URL',
      'setting:OTHER_KEY',
      'setting:THIRD_KEY',
    ]);
    expect(settings.find((n) => n.id === 'setting:NEXT_PUBLIC_URL')).toMatchObject({
      public: true,
    });
    expect(JSON.stringify(graph)).not.toContain(FAKE_SECRET);
  });
});

describe('databases', () => {
  it('detects Drizzle clients and the tables they read and write', async () => {
    const graph = await graphOf({
      'db/index.ts':
        "import { drizzle } from 'drizzle-orm/node-postgres';\nexport const db = drizzle(process.env.DATABASE_URL!);",
      'db/schema.ts': 'export const users = {}; export const posts = {};',
      'app/api/route.ts': [
        "import { db } from '@/db';",
        "import { users, posts } from '@/db/schema';",
        "import * as schema from '@/db/schema';",
        'export async function GET() {',
        '  await db.select().from(users);',
        '  await db.query.posts.findMany();',
        '  await db.insert(schema.posts).values({});',
        '  await db.delete(users);',
        '}',
      ].join('\n'),
    });
    expect(connection(graph, 'file:db/index.ts', 'database:postgres')?.label).toBe('connects to');
    expect(connection(graph, 'file:app/api/route.ts', 'database:postgres')).toMatchObject({
      kind: 'writes',
      label: 'reads, saves and deletes posts and users',
      details: ['posts', 'users'],
    });
  });

  it('detects Supabase clients and table operations', async () => {
    const graph = await graphOf({
      'package.json': JSON.stringify({ name: 'supa', dependencies: { '@supabase/ssr': '1.0.0' } }),
      'utils/supabase/server.ts':
        "import { createServerClient } from '@supabase/ssr';\nexport const createClient = () => createServerClient('', '', {});",
      'app/page.tsx': [
        "import { createClient } from '@/utils/supabase/server';",
        'export default async function Page() {',
        '  const supabase = createClient();',
        "  await supabase.from('profiles').select('*');",
        "  await supabase.from('profiles').upsert({});",
        '}',
      ].join('\n'),
    });
    expect(graph.project.name).toBe('supa');
    expect(connection(graph, 'file:utils/supabase/server.ts', 'database:supabase')?.label).toBe(
      'connects to',
    );
    expect(connection(graph, 'file:app/page.tsx', 'database:supabase')?.label).toBe(
      'reads and saves profiles',
    );
  });

  it('detects Supabase database functions and lists them after tables', async () => {
    const graph = await graphOf({
      'package.json': JSON.stringify({ dependencies: { '@supabase/supabase-js': '2.0.0' } }),
      'lib/db.ts':
        "import { createClient } from '@supabase/supabase-js';\nexport const db = createClient('', '');",
      'app/api/top/route.ts': [
        "import { db } from '@/lib/db';",
        'export async function GET() {',
        "  await db.rpc('get_top', { n: 3 });",
        '}',
      ].join('\n'),
      'app/api/hook/route.ts': [
        "import { db } from '@/lib/db';",
        'export async function POST() {',
        "  await db.rpc('bump');",
        "  await db.from('orders').insert({});",
        '}',
      ].join('\n'),
    });
    expect(connection(graph, 'file:app/api/top/route.ts', 'database:supabase')?.label).toBe(
      'runs get_top()',
    );
    expect(connection(graph, 'file:app/api/hook/route.ts', 'database:supabase')?.label).toBe(
      'saves and runs orders and bump()',
    );
  });

  it('ignores Supabase-style calls when the project does not use Supabase', async () => {
    const graph = await graphOf({
      'app/page.tsx':
        "Array.from('abc').select;\nconst x = { from: (t: string) => ({ select: () => t }) };\nx.from('t').select();",
    });
    expect(graph.nodes.some((n) => n.kind === 'database')).toBe(false);
  });

  it('labels Prisma without a schema file as a generic database', async () => {
    const graph = await graphOf({
      'lib/db.ts':
        "import { PrismaClient } from '@prisma/client';\nexport const prisma = new PrismaClient();",
      'app/page.tsx':
        "import { prisma } from '@/lib/db';\nprisma.category.count();\nother.user.findMany();",
    });
    expect(connection(graph, 'file:app/page.tsx', 'database:database')?.label).toBe(
      'reads from categories',
    );
  });
});

const NEXT_PACKAGE = JSON.stringify({ name: 'shop', dependencies: { next: '15.0.0' } });

function fileNode(graph: Graph, path: string): FileNode | undefined {
  return graph.nodes.find((n): n is FileNode => n.kind === 'file' && n.path === path);
}

describe('Pages Router', () => {
  it('maps pages, layouts and API routes in pages/', async () => {
    const graph = await graphOf({
      'package.json': NEXT_PACKAGE,
      'pages/_app.tsx': 'export default function App({ Component }) { return <Component />; }',
      'pages/_document.tsx': 'export default function Document() { return null; }',
      'pages/index.tsx': 'export default function Home() { return null; }',
      'pages/blog/index.tsx': 'export default function Blog() { return null; }',
      'pages/blog/[slug].tsx': 'export default function Post() { return null; }',
      'pages/404.tsx': 'export default function Missing() { return null; }',
      'pages/api/posts/index.ts': [
        'export default function handler(req, res) {',
        '  switch (req.method) {',
        "    case 'GET': return res.json([]);",
        "    case 'POST': return res.status(201).end();",
        '  }',
        '}',
      ].join('\n'),
      'pages/api/posts/[id].ts': [
        'export default function handler(req, res) {',
        "  if (req.method !== 'DELETE') return res.status(405).end();",
        '  res.end();',
        '}',
      ].join('\n'),
      'pages/api/health.ts': [
        'export default function handler(req, res) {',
        "  if (!['get', 'HEAD'].includes(req.method)) return res.status(405).end();",
        '  res.end();',
        '}',
      ].join('\n'),
      'pages/api/any.ts': 'export default function handler(req, res) { res.end(); }',
    });
    expect(graph.project.framework).toBe('next-pages-router');
    expect(graph.warnings).toEqual([]);
    const summary = (path: string) => {
      const node = fileNode(graph, path);
      return [node?.role, node?.urlPath, node?.methods];
    };
    expect(summary('pages/_app.tsx')).toEqual(['layout', undefined, undefined]);
    expect(summary('pages/_document.tsx')).toEqual(['layout', undefined, undefined]);
    expect(summary('pages/index.tsx')).toEqual(['page', '/', undefined]);
    expect(summary('pages/blog/index.tsx')).toEqual(['page', '/blog', undefined]);
    expect(summary('pages/blog/[slug].tsx')).toEqual(['page', '/blog/[slug]', undefined]);
    expect(summary('pages/404.tsx')).toEqual(['page', '/404', undefined]);
    expect(summary('pages/api/posts/index.ts')).toEqual(['route', '/api/posts', ['GET', 'POST']]);
    expect(summary('pages/api/posts/[id].ts')).toEqual(['route', '/api/posts/[id]', ['DELETE']]);
    expect(summary('pages/api/health.ts')).toEqual(['route', '/api/health', ['GET', 'HEAD']]);
    expect(summary('pages/api/any.ts')).toEqual(['route', '/api/any', []]);
  });

  it('connects links, router calls and requests to pages/ routes', async () => {
    const graph = await graphOf({
      'package.json': NEXT_PACKAGE,
      'src/pages/index.tsx': [
        "import Link from 'next/link';",
        "import { useRouter } from 'next/router';",
        'export default function Home({ id }) {',
        '  const router = useRouter();',
        "  const save = () => fetch(`/api/posts/${id}`, { method: 'DELETE' });",
        "  const done = () => router.push('/blog/hello');",
        '  return <Link href="/about">About</Link>;',
        '}',
      ].join('\n'),
      'src/pages/about.tsx': 'export default function About() { return null; }',
      'src/pages/blog/[slug].tsx': 'export default function Post() { return null; }',
      'src/pages/api/posts/[id].ts':
        "export default function handler(req, res) { if (req.method === 'DELETE') res.end(); }",
    });
    const home = 'file:src/pages/index.tsx';
    expect(connection(graph, home, 'file:src/pages/about.tsx')?.kind).toBe('links');
    expect(connection(graph, home, 'file:src/pages/blog/[slug].tsx')?.kind).toBe('links');
    const request = connection(graph, home, 'file:src/pages/api/posts/[id].ts');
    expect([request?.kind, request?.details]).toEqual(['requests', ['DELETE']]);
  });

  it('recognizes a Next.js project from next.config without a package.json', async () => {
    const graph = await graphOf({
      'next.config.mjs': 'export default {};',
      'pages/index.jsx': 'export default function Home() { return null; }',
    });
    expect(graph.project.framework).toBe('next-pages-router');
    expect(fileNode(graph, 'pages/index.jsx')?.role).toBe('page');
  });

  it('leaves a pages/ folder alone in apps that are not Next.js', async () => {
    const graph = await graphOf({
      'package.json': JSON.stringify({ dependencies: { vite: '7.0.0' } }),
      'src/pages/Home.tsx': 'export default function Home() { return null; }',
    });
    expect(fileNode(graph, 'src/pages/Home.tsx')?.role).toBe('component');
    expect(graph.project.framework).toBe('unknown');
    expect(graph.warnings.map((w) => w.code)).toEqual(['no-next-router']);
  });

  it('maps both folders in a project moving from pages/ to app/', async () => {
    const graph = await graphOf({
      'package.json': NEXT_PACKAGE,
      'app/dashboard/page.tsx': 'export default function Dashboard() { return null; }',
      'pages/index.tsx': 'export default function Home() { return null; }',
    });
    expect(graph.project.framework).toBe('next-app-router');
    expect(fileNode(graph, 'app/dashboard/page.tsx')?.urlPath).toBe('/dashboard');
    expect(fileNode(graph, 'pages/index.tsx')?.urlPath).toBe('/');
  });
});

describe('framework detection', () => {
  it('warns about projects without app/ or pages/', async () => {
    const graph = await graphOf({ 'lib/index.ts': 'export const x = 1;' });
    expect(graph.project.framework).toBe('unknown');
    expect(graph.warnings.map((w) => w.code)).toEqual(['no-next-router']);
  });

  it('warns when the scan was cut short', async () => {
    const created = await makeProject({ 'a.ts': '', 'b.ts': '' });
    cleanups.push(created.cleanup);
    const { graph } = await analyzeProject(created.dir, { maxFiles: 1 });
    expect(graph.warnings.map((w) => w.code)).toContain('truncated');
  });
});
