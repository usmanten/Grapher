import { afterEach, describe, expect, it } from 'vitest';

import { analyzeProject } from '../src/index.js';
import { FAKE_SECRET, makeProject, recordingFileSystem } from './helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/**
 * A project with fake secrets in every place a real one tends to hide. The
 * fake value is built at runtime, so nothing key-shaped is committed.
 */
describe('secret safety of the graph', () => {
  it('never puts a secret value into graph.json', async () => {
    const created = await makeProject({
      '.env': `STRIPE_SECRET_KEY=${FAKE_SECRET}`,
      '.env.local': `DATABASE_URL=postgres://admin:${FAKE_SECRET}@db.example.com/app`,
      'keys/server.pem': FAKE_SECRET,
      'credentials.json': JSON.stringify({ key: FAKE_SECRET }),
      'lib/stripe.ts': `import Stripe from 'stripe';\n// old key: ${FAKE_SECRET}\nexport const stripe = new Stripe('${FAKE_SECRET}');`,
      'lib/db.ts': `import { Pool } from 'pg';\nexport const pool = new Pool({ connectionString: 'postgres://admin:${FAKE_SECRET}@db.example.com/app' });`,
      'lib/api.ts': `fetch('https://api.example.com/v1?token=${FAKE_SECRET}');\nexport const k = process.env.API_KEY;`,
      'app/page.tsx': "import { stripe } from '../lib/stripe';\nexport default () => stripe;",
    });
    cleanups.push(created.cleanup);

    const { fs, reads } = recordingFileSystem();
    const { graph, scan } = await analyzeProject(created.dir, {}, fs);
    const output = JSON.stringify(graph);

    expect(output).not.toContain(FAKE_SECRET);
    expect(output).not.toContain('admin:');
    // The connections are still found, with names only.
    expect(output).toContain('setting:API_KEY');
    expect(output).toContain('service:stripe');
    expect(output).toContain('database:postgres');

    // Secret files are never opened at any stage, not just left out of the output.
    const opened = reads.map((p) => p.slice(scan.root.length + 1).replaceAll('\\', '/')).sort();
    expect(opened).toEqual(['app/page.tsx', 'lib/api.ts', 'lib/db.ts', 'lib/stripe.ts']);
  });
});
