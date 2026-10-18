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

function requestedIds(prompt: string): string[] {
  const marker = /^(GRAPHER-DATA-[0-9a-f]+) BEGIN$/m.exec(prompt)?.[1] ?? '';
  const data = prompt.split(`${marker} BEGIN\n`)[1]?.split(`\n${marker} END`)[0] ?? '[]';
  return (JSON.parse(data) as { id: string }[]).map((t) => t.id);
}

describe('grapher explain', () => {
  it('asks for explanations, saves them, and then has nothing left to ask', async () => {
    const request = await run('explain', dir);
    expect(request.code).toBe(0);
    expect(request.out).toContain('GRAPHER EXPLAIN REQUEST: 1 connection');
    expect(request.out).toContain(`Then run: grapher explain ${JSON.stringify(dir)} --save`);
    const ids = requestedIds(request.out);
    expect(ids).toEqual(['file:app/page.tsx->file:lib/db.ts']);

    await writeFile(
      path.join(dir, '.grapher/answers.json'),
      JSON.stringify({ [ids[0] ?? '']: 'The home page reads the list of users from lib/db.ts.' }),
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
    const ids = requestedIds((await run('explain', dir)).out);
    await writeFile(
      path.join(dir, '.grapher/answers.json'),
      JSON.stringify({ [ids[0] ?? '']: 'Old.' }),
    );
    await run('explain', dir, '--save');

    await writeFile(
      path.join(dir, 'app/page.tsx'),
      "import { db } from '../lib/db';\nexport default function Page() { return db.users.at(0); }",
    );
    expect((await run('explain', dir)).out).toContain('GRAPHER EXPLAIN REQUEST: 1 connection');
  });

  it('saves nothing when an answer contains a secret', async () => {
    const ids = requestedIds((await run('explain', dir)).out);
    const fake = ['sk', 'live', 'FAKEanswerForCliTest', 'z9'].join('_');
    await writeFile(
      path.join(dir, '.grapher/answers.json'),
      JSON.stringify({ [ids[0] ?? '']: `Uses the key ${fake}.` }),
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
