import { describe, expect, it } from 'vitest';

import {
  assertNoSecrets,
  entropy,
  findSecrets,
  findSecretsIn,
  scrub,
  SecretInOutputError,
} from '../src/index.js';
import { FAKE_SECRET } from './helpers.js';

// Fake keys are assembled at runtime so nothing key-shaped is committed.
const j = (...parts: string[]) => parts.join('');
const FAKES = {
  stripe: FAKE_SECRET,
  openai: j('sk-', 'proj-', 'FAKEfakeFAKEfake1234567890abcd'),
  anthropic: j('sk-', 'ant-', 'api03-FAKEfakeFAKEfake1234567890'),
  aws: j('AKIA', 'FAKE1234FAKE5678'),
  google: j('AIza', 'SyFAKEfakeFAKEfake1234567890abcdefg'),
  github: j('ghp_', 'FAKEfakeFAKEfake1234567890abcdefghij'),
  slack: j('xoxb-', '1234567890-FAKEfakeFAKE'),
  jwt: j('eyJ', 'hbGciOiJIUzI1NiJ9', '.eyJ', 'zdWIiOiIxMjM0NTY3ODkwIn0', '.FAKEsignatureFAKE123'),
  random: j('Zq8', 'Lw2mN4vR7tY1', 'xK9pB3cF6hJ0', 'sD5gA'),
};

describe('findSecrets', () => {
  it.each(Object.entries(FAKES))('finds a %s key', (_, value) => {
    expect(scrub(`const k = '${value}';`)).toBe("const k = '[hidden]';");
  });

  it('finds private key blocks', () => {
    const block = j('-----BEGIN ', 'RSA PRIVATE KEY-----\nMIIfake\n-----END RSA PRIVATE KEY-----');
    expect(scrub(`key = \`${block}\``)).toBe('key = `[hidden]`');
  });

  it('hides the login in a URL but keeps the host', () => {
    expect(scrub("connect('postgres://admin:hunter2pass@db.example.com:5432/app')")).toBe(
      "connect('postgres://[hidden]@db.example.com:5432/app')",
    );
    expect(scrub("fetch('https://plaintokenvalue@api.example.com')")).toBe(
      "fetch('https://[hidden]@api.example.com')",
    );
  });

  it('hides values assigned to secret-sounding names', () => {
    const value = j('fake', 'Value', '1234');
    expect(scrub(`const password = "${value}";`)).toBe('const password = "[hidden]";');
    expect(scrub(`{ apiKey: '${value}' }`)).toBe("{ apiKey: '[hidden]' }");
    expect(scrub(`AUTH_SECRET="${value}"`)).toBe('AUTH_SECRET="[hidden]"');
  });

  it('leaves ordinary code alone', () => {
    const code = [
      "import { db } from '@/lib/db';",
      'const users = await db.user.findMany({ select: { id: true } });',
      'const token = process.env.API_TOKEN;',
      "const id = '3f2b8c1e-4d5a-4e6f-8a9b-0c1d2e3f4a5b';",
      "const sha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';",
      "const name = 'handleUserAccountSettingsChangeRequest';",
      "const className = 'flex items-center justify-between rounded-lg';",
      'const password = await hash(input.password);',
      "const tokenType = 'Bearer';",
    ].join('\n');
    expect(findSecrets(code)).toEqual([]);
  });

  it('does not flag text that is already scrubbed', () => {
    const once = scrub(
      `db('postgres://admin:${FAKE_SECRET}@h/app', { password: '${FAKE_SECRET}' })`,
    );
    expect(once).toBe("db('postgres://[hidden]@h/app', { password: '[hidden]' })");
    expect(findSecrets(once)).toEqual([]);
    expect(scrub(once)).toBe(once);
  });

  it('merges overlapping matches', () => {
    const text = `secret = '${FAKE_SECRET}'`;
    expect(findSecrets(text)).toHaveLength(1);
  });

  it('scores random text higher than words', () => {
    expect(entropy(FAKES.random)).toBeGreaterThan(entropy('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
    expect(entropy('')).toBe(0);
  });
});

describe('output check', () => {
  it('reports where a secret is, never the value', () => {
    const findings = findSecretsIn({ nodes: [{ path: `lib/${FAKE_SECRET}.ts` }], ok: 'fine' });
    expect(findings).toEqual([{ where: 'nodes[0].path', kind: 'known-key-format' }]);
  });

  it('checks object keys too', () => {
    expect(findSecretsIn({ [FAKE_SECRET]: 1 })).toHaveLength(1);
  });

  it('throws an error that does not contain the value', () => {
    const value = { a: Array.from({ length: 7 }, () => FAKE_SECRET) };
    let error: unknown;
    try {
      assertNoSecrets(value);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SecretInOutputError);
    const message = (error as Error).message;
    expect(message).toContain('a[0] (known key format)');
    expect(message).toContain('and 2 more');
    expect(message).not.toContain(FAKE_SECRET);
  });

  it('passes clean output', () => {
    expect(() => {
      assertNoSecrets({ label: 'reads setting', name: 'STRIPE_SECRET_KEY' });
    }).not.toThrow();
  });
});
