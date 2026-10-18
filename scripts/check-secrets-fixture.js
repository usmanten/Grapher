// Builds a throwaway Next.js project full of fake secrets, runs `grapher graph`
// on it, and fails if any fake value shows up in what Grapher writes.
// The fake values are assembled here at runtime, so nothing key-shaped is
// committed to the repository.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const j = (...parts) => parts.join('');
const fakes = {
  'Stripe key': j('sk_', 'live_', 'FIXTUREfake0nly', 'Q9x2'),
  'OpenAI key': j('sk-', 'proj-', 'FIXTUREfakeFIXTUREfake123456'),
  'AWS key': j('AKIA', 'FIXTURE0FAKE1234'),
  'GitHub token': j('ghp_', 'FIXTUREfakeFIXTUREfake1234567890abcdef'),
  'database password': j('Fixture', 'Pa55word', 'Only'),
  'random string': j('Zq8Lw2', 'mN4vR7tY1xK9', 'pB3cF6hJ0sD5gA'),
  'private key body': j('MIIEfixture', 'FAKEprivateKEYbody'),
};

const files = {
  '.env': `STRIPE_SECRET_KEY=${fakes['Stripe key']}\nOPENAI_API_KEY=${fakes['OpenAI key']}`,
  '.env.local': `DATABASE_URL=postgres://admin:${fakes['database password']}@db.example.com/app`,
  '.env.production': `AWS_ACCESS_KEY_ID=${fakes['AWS key']}`,
  'certs/server.key': j(
    '-----BEGIN ',
    `PRIVATE KEY-----\n${fakes['private key body']}\n-----END PRIVATE KEY-----`,
  ),
  'credentials.json': JSON.stringify({ token: fakes['GitHub token'] }),
  'package.json': JSON.stringify({
    name: 'secrets-fixture',
    dependencies: { next: '16.0.0', stripe: '19.0.0', pg: '8.0.0' },
  }),
  'app/page.tsx':
    "import { stripe } from '@/lib/stripe';\nexport default function Page() { return <p>{String(stripe)}</p>; }",
  'app/api/data/route.ts': [
    "import { pool } from '@/lib/db';",
    `// old key, remove later: ${fakes['OpenAI key']}`,
    `export async function GET() { await fetch('https://${fakes['GitHub token']}@api.example.com/x?key=${fakes['random string']}'); return Response.json(await pool.query('select 1')); }`,
  ].join('\n'),
  'lib/stripe.ts': `import Stripe from 'stripe';\nexport const stripe = new Stripe('${fakes['Stripe key']}');`,
  'lib/db.ts': `import { Pool } from 'pg';\nexport const pool = new Pool({ connectionString: 'postgres://admin:${fakes['database password']}@db.example.com/app', password: '${fakes['database password']}' });`,
  'lib/aws.ts': `export const awsKey = '${fakes['AWS key']}';\nexport const signing = '${fakes['random string']}';\nexport const region = process.env.AWS_REGION;`,
  'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./*'] } } }),
};

const repo = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(path.join(tmpdir(), 'grapher-secrets-'));
try {
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), contents);
  }

  const cli = path.join(repo, 'packages/cli/dist/index.js');
  execFileSync(process.execPath, [cli, 'graph', dir], { stdio: 'inherit' });
  // The text /grapher hands to Claude for explanations must be clean too.
  const request = execFileSync(process.execPath, [cli, 'explain', dir], { encoding: 'utf8' });

  const outputs = {
    'graph.json': await readFile(path.join(dir, '.grapher/graph.json'), 'utf8'),
    'index.html': await readFile(path.join(dir, '.grapher/index.html'), 'utf8'),
    'explain request': request,
  };
  const leaks = [];
  for (const [file, text] of Object.entries(outputs)) {
    for (const [kind, value] of Object.entries(fakes)) {
      if (text.includes(value)) leaks.push(`${kind} in ${file}`);
    }
  }
  // Make sure the run actually looked at the secret-laden code, so a clean
  // result means something.
  const hidden = (outputs['graph.json'].match(/\[hidden\]/g) ?? []).length;
  if (hidden < 4) leaks.push(`expected scrubbed snippets in graph.json, found ${hidden}`);
  if (!request.includes('[hidden]'))
    leaks.push('expected scrubbed snippets in the explain request');

  if (leaks.length > 0) {
    console.error(`\nSecrets fixture FAILED:\n  ${leaks.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log(
      `\nSecrets fixture passed: no fake secret in the output (${hidden} values hidden).`,
    );
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
