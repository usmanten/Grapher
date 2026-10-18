import { describe, expect, it } from 'vitest';

import { formatScanSummary } from '../src/format.js';

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
});
