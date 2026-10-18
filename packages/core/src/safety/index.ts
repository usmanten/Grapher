export {
  entropy,
  findSecrets,
  REDACTED,
  scrub,
  type SecretKind,
  type SecretMatch,
} from './detect.js';
export {
  assertNoSecrets,
  findSecretsIn,
  type OutputFinding,
  SecretInOutputError,
} from './check.js';
