import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { expect, test } from '@playwright/test';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const sampleApp = `${repo}examples/sample-app`;
const page = `${sampleApp}/.grapher/index.html`;

test.beforeAll(() => {
  // Uses the built CLI, exactly as a user would.
  execFileSync(process.execPath, [`${repo}packages/cli/dist/index.js`, 'graph', sampleApp]);
});

test('explores the sample app without errors or blocked content', async ({ page: tab }) => {
  const problems: string[] = [];
  tab.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') problems.push(msg.text());
  });
  tab.on('pageerror', (error) => problems.push(error.message));
  const requests: string[] = [];
  tab.on('request', (request) => {
    if (!request.url().startsWith('file:')) requests.push(request.url());
  });

  await tab.goto(pathToFileURL(page).href);
  await expect(tab.getByRole('heading', { level: 1 })).toHaveText('app/page.tsx');

  // Pick a file from the tree.
  await tab
    .getByRole('navigation', { name: 'Files' })
    .getByRole('button', { name: 'SignupForm.tsx' })
    .click();
  await expect(tab.getByRole('heading', { level: 1 })).toHaveText('components/SignupForm.tsx');

  // Click a connection and read its explanation.
  const canvas = tab.locator('.react-flow');
  const panel = tab.getByRole('complementary', { name: 'Explanation' });
  const label = (text: string) =>
    canvas.locator('.react-flow__edge', { hasText: text }).locator('.react-flow__edge-textbg');
  await label('displays').click();
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(
    'signup/page.tsx → components/SignupForm.tsx',
  );
  await label('sends a POST request to').click();
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(
    'components/SignupForm.tsx → users/route.ts',
  );
  await expect(panel).toContainText('(/api/users)');
  await expect(panel.locator('pre').first()).toContainText("fetch('/api/users'");
  await expect(panel).toContainText('Run /grapher in Claude Code');
  const link = panel.getByRole('link', { name: /^components\/SignupForm\.tsx:\d+$/ });
  await expect(link).toHaveAttribute(
    'href',
    /^vscode:\/\/file\/.+\/components\/SignupForm\.tsx:\d+$/,
  );

  // Follow the whole flow, then the overview.
  await tab.getByRole('button', { name: 'Trace full flow' }).click();
  await expect(tab.getByRole('heading', { level: 1 })).toHaveText(
    'Full flow through components/SignupForm.tsx',
  );
  await tab.getByRole('button', { name: 'Overview' }).click();
  await expect(tab.getByRole('heading', { level: 1 })).toHaveText('Overview');

  expect(problems).toEqual([]);
  expect(requests).toEqual([]);
});

test('the page ships a strict Content Security Policy', () => {
  const html = readFileSync(page, 'utf8');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
  expect(csp).toContain("default-src 'none'");
  expect(csp).toMatch(/script-src 'sha256-[^']+'(;|$)/);
  expect(csp).not.toContain('unsafe-inline');
  expect(csp).not.toContain('unsafe-eval');
});

test('grays out a file that nothing uses', async ({ page: tab }) => {
  // A copy of the sample app with one extra component that nothing imports.
  const copy = mkdtempSync(join(tmpdir(), 'grapher-unused-'));
  try {
    cpSync(sampleApp, copy, { recursive: true, filter: (src) => !src.includes('.grapher') });
    writeFileSync(
      join(copy, 'components/OldBanner.tsx'),
      'export function OldBanner() {\n  return <div>Sale!</div>;\n}\n',
    );
    execFileSync(process.execPath, [`${repo}packages/cli/dist/index.js`, 'graph', copy]);
    await tab.goto(pathToFileURL(join(copy, '.grapher/index.html')).href);

    const tree = tab.getByRole('navigation', { name: 'Files' });
    await expect(tree.locator('button.unused')).toHaveCount(1);
    await tree.getByRole('button', { name: 'OldBanner.tsx unused' }).click();
    await expect(tab.getByRole('heading', { level: 1 })).toHaveText('components/OldBanner.tsx');
    await expect(tab.locator('.canvas-head')).toContainText('Nothing in your code uses this file.');
    await expect(tab.locator('.box.unused')).toHaveCount(1);
    // Pages and routes nothing links to are still started by Next.js, so they stay in color.
    await expect(tree.getByRole('button', { name: 'layout.tsx' })).not.toHaveClass(/unused/);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});
