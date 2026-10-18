import { describe, expect, it } from 'vitest';

import { isSecretDirectory, isSecretFile } from '../src/index.js';

describe('isSecretFile', () => {
  it.each([
    '.env',
    '.env.local',
    '.env.production',
    'apps/web/.env.development.local',
    '.ENV',
    '.dev.vars',
    '.env ',
    '.env.',
    '.envrc',
    '.vault-token',
    'certs/server.pem',
    'private.key',
    'AuthKey_ABC123.p8',
    'keystore.jks',
    'id_rsa',
    'id_ed25519.pub',
    '.npmrc',
    '.netrc',
    'credentials',
    'credentials.json',
    'gcp-credentials.json',
    'secrets.yml',
    'secret.txt',
    'secrets.local.json',
    'my-service-account.json',
    'service_account_key.json',
    'firebase-adminsdk-abc12.json',
    'terraform.tfstate',
    'prod.tfvars',
  ])('blocks %s', (file) => {
    expect(isSecretFile(file)).toBe(true);
  });

  it.each([
    '.env.example',
    '.env.sample',
    '.env.template',
    'src/lib/env.ts',
    'src/lib/secrets.ts',
    'src/secrets.d.ts',
    'app/api/keys/route.ts',
    'monkey.ts',
    'keyboard.tsx',
    'README.md',
    'package.json',
    'prisma/schema.prisma',
  ])('allows %s', (file) => {
    expect(isSecretFile(file)).toBe(false);
  });
});

describe('isSecretDirectory', () => {
  it.each(['.ssh', '.aws', '.docker', 'home/.gnupg'])('blocks %s', (dir) => {
    expect(isSecretDirectory(dir)).toBe(true);
  });

  it.each(['src', 'app/api', 'ssh'])('allows %s', (dir) => {
    expect(isSecretDirectory(dir)).toBe(false);
  });
});
