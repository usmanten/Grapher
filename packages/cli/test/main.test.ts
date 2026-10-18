import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { main } from '../src/main.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'grapher-cli-'));
  await writeFile(path.join(dir, 'page.tsx'), 'export default function Page() {}');
  await writeFile(path.join(dir, '.env'), 'KEY=not-a-real-value');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function run(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (t) => out.push(t), err: (t) => err.push(t) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('grapher CLI', () => {
  it('prints a readable scan summary that names protected secret files', async () => {
    const { code, out } = await run('scan', dir);

    expect(code).toBe(0);
    expect(out).toContain('1 file ready to analyze');
    expect(out).toContain('1 secret files (never opened): .env');
    expect(out).not.toContain('not-a-real-value');
  });

  it('prints JSON with --json', async () => {
    const { code, out } = await run('scan', dir, '--json');

    expect(code).toBe(0);
    const parsed = JSON.parse(out) as { files: { path: string }[] };
    expect(parsed.files.map((f) => f.path)).toEqual(['page.tsx']);
  });

  it('shows help with no command or --help', async () => {
    expect((await run()).out).toContain('Usage: grapher');
    expect((await run('--help')).out).toContain('Usage: grapher');
  });

  it('prints the version', async () => {
    expect((await run('--version')).out).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('rejects unknown commands and flags with exit code 2', async () => {
    expect((await run('explode')).code).toBe(2);
    expect((await run('scan', dir, 'extra')).code).toBe(2);
    expect((await run('--nope')).code).toBe(2);
  });

  it('exits 1 with a clear message when the folder is missing', async () => {
    const { code, err } = await run('scan', path.join(dir, 'missing'));

    expect(code).toBe(1);
    expect(err).toContain('Folder not found');
  });
});

describe('grapher graph', () => {
  it('maps the project, saves graph.json and index.html, and never prints secret values', async () => {
    await writeFile(
      path.join(dir, 'route.ts'),
      "export const k = process.env.KEY;\nimport Stripe from 'stripe';\nStripe;",
    );
    const { code, out } = await run('graph', dir);

    expect(code).toBe(0);
    expect(out).toContain('Mapped');
    expect(out).toContain('Outside services: Stripe');
    expect(out).toContain('1 setting (names only, never values)');
    expect(out).toContain('Saved .grapher/graph.json and .grapher/index.html');
    expect(out).toContain('file://');
    expect(out).toContain('Note: No Next.js app/ folder was found');
    expect(out).not.toContain('not-a-real-value');
    const saved = JSON.parse(await readFile(path.join(dir, '.grapher/graph.json'), 'utf8')) as {
      schemaVersion: number;
    };
    expect(saved.schemaVersion).toBe(1);

    const page = await readFile(path.join(dir, '.grapher/index.html'), 'utf8');
    expect(page).toContain('Content-Security-Policy');
    expect(page).toContain('"setting:KEY"');
    expect(page).not.toContain('not-a-real-value');
    expect(page).not.toContain('__GRAPHER_DATA__');
    expect(page).toContain('"protectedFiles":[".env"]');
  });

  it('prints the graph with --json and saves nothing', async () => {
    const { code, out } = await run('graph', dir, '--json');

    expect(code).toBe(0);
    expect((JSON.parse(out) as { nodes: unknown[] }).nodes.length).toBeGreaterThan(0);
    await expect(readFile(path.join(dir, '.grapher/graph.json'))).rejects.toThrow();
  });
});
