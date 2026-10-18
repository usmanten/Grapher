import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
