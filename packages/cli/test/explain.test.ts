import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { main } from '../src/main.js';
import { commandFile, grapherInvocation, setup } from '../src/setup.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'grapher-explain-'));
  await mkdir(path.join(dir, 'app'));
  await mkdir(path.join(dir, 'lib'));
  await writeFile(path.join(dir, 'lib/db.ts'), 'export const db = { users: [] };');
  await writeFile(
    path.join(dir, 'app/page.tsx'),
    "import { db } from '../lib/db';\nexport default function Page() { return db.users.length; }",
  );
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

interface Requested {
  n: number;
  from: string;
  to: string;
}

function requested(prompt: string): Requested[] {
  const marker = /^(GRAPHER-DATA-[0-9a-f]+) BEGIN$/m.exec(prompt)?.[1] ?? '';
  const data = prompt.split(`${marker} BEGIN\n`)[1]?.split(`\n${marker} END`)[0] ?? '[]';
  return JSON.parse(data) as Requested[];
}

describe('grapher explain', () => {
  it('asks for explanations, saves them, and then has nothing left to ask', async () => {
    const request = await run('explain', dir);
    expect(request.code).toBe(0);
    expect(request.out).toContain('GRAPHER EXPLAIN REQUEST: 1 connection');
    expect(request.out).toContain(`Then run: grapher explain ${JSON.stringify(dir)} --save`);
    expect(requested(request.out)).toMatchObject([
      { n: 1, from: 'app/page.tsx (page for /)', to: 'lib/db.ts (module)' },
    ]);

    await writeFile(
      path.join(dir, '.grapher/answers.json'),
      JSON.stringify({ 1: 'The home page reads the list of users from lib/db.ts.' }),
    );
    const save = await run('explain', dir, '--save');
    expect(save.code).toBe(0);
    expect(save.out).toContain('Saved 1 explanation');
    expect(save.out).toContain('Every connection is explained.');
    await expect(readFile(path.join(dir, '.grapher/answers.json'))).rejects.toThrow();
    const page = await readFile(path.join(dir, '.grapher/index.html'), 'utf8');
    expect(page).toContain('The home page reads the list of users from lib/db.ts.');

    const again = await run('explain', dir);
    expect(again.out).toContain('All 1 connections are explained.');

    // graph keeps the saved explanations in the page.
    await run('graph', dir);
    expect(await readFile(path.join(dir, '.grapher/index.html'), 'utf8')).toContain(
      'The home page reads the list of users',
    );
  });

  it('asks again when the code behind a connection changes', async () => {
    await run('explain', dir);
    await writeFile(path.join(dir, '.grapher/answers.json'), JSON.stringify({ 1: 'Old.' }));
    await run('explain', dir, '--save');

    await writeFile(
      path.join(dir, 'app/page.tsx'),
      "import { db } from '../lib/db';\nexport default function Page() { return db.users.at(0); }",
    );
    expect((await run('explain', dir)).out).toContain('GRAPHER EXPLAIN REQUEST: 1 connection');
  });

  it('prints the next request right after saving part of the answers', async () => {
    await writeFile(
      path.join(dir, 'lib/auth.ts'),
      "import { db } from './db';\nexport const user = () => db.users[0];",
    );
    await writeFile(
      path.join(dir, 'app/page.tsx'),
      "import { db } from '../lib/db';\nimport { user } from '../lib/auth';\nexport default function Page() { return db.users.length + String(user()); }",
    );
    const first = requested((await run('explain', dir)).out);
    expect(first).toHaveLength(3);
    await writeFile(
      path.join(dir, '.grapher/answers.json'),
      JSON.stringify({ 1: 'The home page uses a helper.' }),
    );

    const save = await run('explain', dir, '--save');

    expect(save.out).toContain('Saved 1 explanation');
    expect(save.out).toContain('GRAPHER EXPLAIN REQUEST: 2 connections');
    // Renumbered from 1, for the connections still waiting.
    expect(requested(save.out)).toEqual(first.slice(1).map((c, i) => ({ ...c, n: i + 1 })));
  });

  it("doesn't save an answer for code that changed after the request", async () => {
    await run('explain', dir);
    await writeFile(
      path.join(dir, 'app/page.tsx'),
      "import { db } from '../lib/db';\nexport default function Page() { return db.users.at(0); }",
    );
    await writeFile(path.join(dir, '.grapher/answers.json'), JSON.stringify({ 1: 'Stale.' }));

    const save = await run('explain', dir, '--save');

    expect(save.out).toContain('Saved 0 explanations');
    expect(save.out).toContain('GRAPHER EXPLAIN REQUEST: 1 connection');
    expect(await readFile(path.join(dir, '.grapher/index.html'), 'utf8')).not.toContain('Stale.');
  });

  it('saves nothing when an answer contains a secret', async () => {
    await run('explain', dir);
    const fake = ['sk', 'live', 'FAKEanswerForCliTest', 'z9'].join('_');
    await writeFile(
      path.join(dir, '.grapher/answers.json'),
      JSON.stringify({ 1: `Uses the key ${fake}.` }),
    );

    const save = await run('explain', dir, '--save');

    expect(save.code).toBe(1);
    expect(save.err).toContain('Stopped before saving');
    expect(save.err).not.toContain(fake);
    await expect(readFile(path.join(dir, '.grapher/explanations.json'))).rejects.toThrow();
  });

  it('explains what to do when there is no answer yet', async () => {
    const save = await run('explain', dir, '--save');
    expect(save.code).toBe(1);
    expect(save.err).toContain('No answer found');
  });

  it('only accepts --save with explain', async () => {
    expect((await run('graph', dir, '--save')).code).toBe(2);
  });
});

function requestedPackages(prompt: string): string[] {
  const marker = /^(GRAPHER-DATA-[0-9a-f]+) BEGIN$/m.exec(prompt)?.[1] ?? '';
  const data = prompt.split(`${marker} BEGIN\n`)[1]?.split(`\n${marker} END`)[0] ?? '[]';
  return JSON.parse(data) as string[];
}

describe('identifying unknown packages', () => {
  beforeEach(async () => {
    await writeFile(
      path.join(dir, 'lib/ship.ts'),
      [
        "import { Courier } from 'courier-labels';",
        "import { tween } from 'tween-magic';",
        "import { mystery } from 'mystery-pkg';",
        "import { store } from 'tiny-kv';",
        'export const c = new Courier(); tween(); mystery(); store();',
      ].join('\n'),
    );
  });

  it('shows unknown packages as gray boxes until Claude identifies them by name', async () => {
    const graph = await run('graph', dir, '--json');
    const parsed = JSON.parse(graph.out) as { nodes: { id: string; unidentified?: boolean }[] };
    expect(parsed.nodes.find((n) => n.id === 'service:courier-labels')?.unidentified).toBe(true);

    const request = await run('explain', dir);
    expect(request.out).toContain('GRAPHER IDENTIFY REQUEST: 4 packages');
    expect(requestedPackages(request.out)).toEqual([
      'courier-labels',
      'mystery-pkg',
      'tiny-kv',
      'tween-magic',
    ]);
    // Names only: no code or file names go out with the request.
    expect(request.out).not.toContain('lib/ship.ts');
    expect(request.out).not.toContain('new Courier');

    await writeFile(
      path.join(dir, '.grapher/answers.json'),
      JSON.stringify({
        'courier-labels': { kind: 'service', label: 'Courier Labels' },
        'tween-magic': { kind: 'library', label: 'tween-magic' },
        'tiny-kv': { kind: 'database', label: 'TinyKV' },
        'not-asked': { kind: 'service', label: 'Sneaky' },
        // mystery-pkg left out on purpose: it is recorded as unknown.
      }),
    );
    const save = await run('explain', dir, '--save');
    expect(save.code).toBe(0);
    expect(save.out).toContain('Identified 4 packages: 2 added to the map');
    // The next request comes straight after, so Claude needs no extra step.
    expect(save.out).toContain('GRAPHER EXPLAIN REQUEST');

    const after = JSON.parse((await run('graph', dir, '--json')).out) as {
      nodes: { id: string; label?: string; identifiedBy?: string; unidentified?: boolean }[];
      connections: { to: string; label: string }[];
    };
    const ids = after.nodes.map((n) => n.id);
    expect(after.nodes.find((n) => n.id === 'service:courier-labels')).toMatchObject({
      label: 'Courier Labels',
      identifiedBy: 'ai',
    });
    expect(after.nodes.find((n) => n.id === 'database:tiny-kv')).toMatchObject({
      label: 'TinyKV',
      identifiedBy: 'ai',
    });
    expect(ids).not.toContain('service:tween-magic');
    expect(ids).not.toContain('service:not-asked');
    expect(after.nodes.find((n) => n.id === 'service:mystery-pkg')?.unidentified).toBe(true);
    expect(after.connections.find((c) => c.to === 'service:mystery-pkg')?.label).toBe(
      'uses the mystery-pkg package',
    );

    // Every package has an answer now, so the next request is about connections.
    const next = await run('explain', dir);
    expect(next.out).toContain('GRAPHER EXPLAIN REQUEST');
    const saved = await readFile(path.join(dir, '.grapher/packages.json'), 'utf8');
    expect(JSON.parse(saved)).toMatchObject({ entries: { 'mystery-pkg': { kind: 'unknown' } } });
  });

  it('drops tampered entries in the saved package file', async () => {
    await mkdir(path.join(dir, '.grapher'), { recursive: true });
    await writeFile(
      path.join(dir, '.grapher/packages.json'),
      JSON.stringify({
        entries: {
          'courier-labels': { kind: 'service', label: 'Courier\u0000 Labels' },
          'tween-magic': { kind: 'evil', label: 'x' },
          '../escape': { kind: 'service', label: 'x' },
        },
      }),
    );
    const request = await run('explain', dir);
    expect(requestedPackages(request.out)).toEqual(['mystery-pkg', 'tiny-kv', 'tween-magic']);
    const graph = JSON.parse((await run('graph', dir, '--json')).out) as {
      nodes: { id: string; label?: string }[];
    };
    expect(graph.nodes.find((n) => n.id === 'service:courier-labels')?.label).toBe(
      'Courier Labels',
    );
  });
});

describe('grapher setup', () => {
  it('installs the /grapher command with this CLI filled in', async () => {
    const file = await setup(path.join(dir, '.claude'));
    const text = await readFile(file, 'utf8');
    expect(file).toBe(path.join(dir, '.claude/commands/grapher.md'));
    expect(text).toContain(`Run \`${grapherInvocation()} explain <folder>\``);
    expect(text).not.toContain('{{GRAPHER}}');
    expect(text).toMatch(/^---\ndescription: /);
  });

  it('replaces its own command file but never anyone else’s', async () => {
    const claude = path.join(dir, '.claude');
    await setup(claude);
    await expect(setup(claude)).resolves.toBeDefined();

    await writeFile(path.join(claude, 'commands/grapher.md'), 'my own command');
    await expect(setup(claude)).rejects.toThrow("wasn't written by Grapher");
    expect(await readFile(path.join(claude, 'commands/grapher.md'), 'utf8')).toBe('my own command');
  });

  it('quotes paths with spaces', async () => {
    expect(await commandFile('"/a b/node" /c/index.js')).toContain(
      'Bash("/a b/node" /c/index.js explain:*)',
    );
  });
});
