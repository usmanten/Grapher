import { findSecrets, type SecretKind } from './detect.js';

export interface OutputFinding {
  /** Where in the output, like `connections[4].locations[0].code`. Never the value. */
  where: string;
  kind: SecretKind;
}

function walk(value: unknown, where: string, findings: OutputFinding[]): void {
  if (typeof value === 'string') {
    for (const match of findSecrets(value)) findings.push({ where, kind: match.kind });
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => {
      walk(item, `${where}[${i}]`, findings);
    });
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      walk(key, where ? `${where} (key)` : '(key)', findings);
      walk(item, where ? `${where}.${key}` : key, findings);
    }
  }
}

/** Every secret-looking string anywhere in a value, by location and kind only. */
export function findSecretsIn(value: unknown): OutputFinding[] {
  const findings: OutputFinding[] = [];
  walk(value, '', findings);
  return findings;
}

/** Thrown when output would contain something secret-looking. Its message never includes the value. */
export class SecretInOutputError extends Error {
  readonly findings: OutputFinding[];

  constructor(findings: OutputFinding[]) {
    const list = findings
      .slice(0, 5)
      .map((f) => `  ${f.where} (${f.kind.replaceAll('-', ' ')})`)
      .join('\n');
    const more = findings.length > 5 ? `\n  and ${findings.length - 5} more` : '';
    super(
      `Stopped before saving: the output contains something that looks like a secret.\n${list}${more}\nNothing was written. If this is a false alarm, please open an issue describing the kind of value (never the value itself).`,
    );
    this.name = 'SecretInOutputError';
    this.findings = findings;
  }
}

/** Throws if anything in the value looks like a secret, so callers fail closed. */
export function assertNoSecrets(value: unknown): void {
  const findings = findSecretsIn(value);
  if (findings.length > 0) throw new SecretInOutputError(findings);
}
