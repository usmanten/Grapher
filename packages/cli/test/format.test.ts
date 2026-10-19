import { describe, expect, it } from 'vitest';

import { formatGraphSummary, formatScanSummary } from '../src/format.js';

describe('formatScanSummary', () => {
  it('lists every secret file but caps other groups', () => {
    const skipped = [
      ...Array.from({ length: 7 }, (_, i) => ({
        path: `.env.${i}`,
        reason: 'secret-file' as const,
      })),
      ...Array.from({ length: 7 }, (_, i) => ({
        path: `log${i}.txt`,
        reason: 'gitignored' as const,
      })),
    ];

    const text = formatScanSummary({ root: '/p', files: [], skipped, truncated: true });

    expect(text).toContain('0 files ready to analyze');
    expect(text).toContain('.env.6');
    expect(text).toContain(
      '7 ignored by .gitignore: log0.txt, log1.txt, log2.txt, log3.txt, log4.txt, and 2 more',
    );
    expect(text).toContain('Stopped early');
  });

  it('replaces terminal control characters in file names', () => {
    const text = formatScanSummary({
      root: '/p',
      files: [],
      skipped: [{ path: 'evil\u001b[2Jname.env', reason: 'secret-file' }],
      truncated: false,
    });

    expect(text).not.toContain('\u001b');
    expect(text).toContain('evil?[2Jname.env');
  });
});

describe('formatGraphSummary', () => {
  it('summarizes what was found and lists unidentified packages', () => {
    const text = formatGraphSummary({
      schemaVersion: 1,
      project: { name: 'demo', framework: 'next-app-router' },
      nodes: [
        { id: 'file:app/page.tsx', kind: 'file', path: 'app/page.tsx', role: 'page' },
        { id: 'database:postgres', kind: 'database', label: 'Postgres' },
      ],
      connections: [],
      unknownPackages: ['mystery-sdk'],
      warnings: [],
    });

    expect(text).toContain('1 file, including 1 page and 0 API routes');
    expect(text).toContain('Databases: Postgres');
    expect(text).toContain('Not yet identified: mystery-sdk');
    expect(text).not.toContain('Outside services');
  });

  it('counts each Flask, FastAPI or Django route on its own', () => {
    const text = formatGraphSummary({
      schemaVersion: 1,
      project: { name: 'api', framework: 'flask' },
      nodes: [
        {
          id: 'file:app.py',
          kind: 'file',
          path: 'app.py',
          role: 'route',
          routes: [
            { path: '/', methods: ['GET'] },
            { path: '/login', methods: ['POST'] },
          ],
        },
      ],
      connections: [],
      unknownPackages: [],
      warnings: [],
    });
    expect(text).toContain('1 file, including 0 pages and 2 web routes');
  });
});
