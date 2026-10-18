/**
 * Finds text that looks like a secret: keys with a known format, private key
 * blocks, passwords inside URLs, values assigned to secret-sounding names, and
 * long random-looking strings. Used both to scrub code snippets and to check
 * everything Grapher writes before it is saved.
 *
 * Matches are reported by position and kind only. The matched text itself is
 * never returned, logged or put in an error message.
 */

export const REDACTED = '[hidden]';

export type SecretKind =
  'private-key' | 'known-key-format' | 'url-credentials' | 'secret-assignment' | 'random-string';

export interface SecretMatch {
  kind: SecretKind;
  start: number;
  end: number;
}

interface Detector {
  kind: SecretKind;
  pattern: RegExp;
  /** Which capture group holds the secret itself; 0 for the whole match. */
  group?: number;
}

/** Key formats published by the services that issue them. */
const KNOWN_KEY_FORMATS = [
  /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{10,}/, // Stripe secret and restricted keys
  /\bwhsec_[0-9A-Za-z]{16,}/, // Stripe webhook secrets
  /\bsk-(?:ant-|proj-)?[0-9A-Za-z_-]{20,}/, // Anthropic and OpenAI
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, // AWS access key IDs
  /\bAIza[0-9A-Za-z_-]{35}/, // Google API keys
  /\bgh[pousr]_[0-9A-Za-z]{36,}/, // GitHub tokens
  /\bgithub_pat_[0-9A-Za-z_]{22,}/, // GitHub fine-grained tokens
  /\bglpat-[0-9A-Za-z_-]{20,}/, // GitLab tokens
  /\bxox[abposr]-[0-9A-Za-z-]{10,}/, // Slack tokens
  /\bSG\.[0-9A-Za-z_-]{16,}\.[0-9A-Za-z_-]{16,}/, // SendGrid
  /\bre_[0-9A-Za-z]{8,}_[0-9A-Za-z]{8,}/, // Resend
  /\bhf_[0-9A-Za-z]{30,}/, // Hugging Face
  /\bnpm_[0-9A-Za-z]{36}/, // npm
  /\beyJ[0-9A-Za-z_-]{8,}\.eyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}/, // JSON Web Tokens
];

const DETECTORS: Detector[] = [
  {
    kind: 'private-key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  },
  ...KNOWN_KEY_FORMATS.map((p) => ({
    kind: 'known-key-format' as const,
    pattern: new RegExp(p.source, 'g'),
  })),
  // scheme://user:password@host keeps the scheme and host, and hides the whole login.
  {
    kind: 'url-credentials',
    pattern: /\b[a-z][a-z0-9+.-]{1,20}:\/\/([^\s/@'"`]+)@/gi,
    group: 1,
  },
  // Any `name = "value"` or `name: 'value'`; the name is checked separately below.
  {
    kind: 'secret-assignment',
    pattern: /([A-Za-z_][\w-]{0,63})["']?[ \t]{0,8}[:=][ \t]{0,8}["'`]([^"'`\s]{8,512})["'`]/g,
    group: 2,
  },
];

/** Names that usually hold a secret, like `password`, `apiKey` or `STRIPE_SECRET`. */
const SECRET_NAME =
  /password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?key|auth|credential/i;

/** Long runs of characters that keys are usually made of. */
const CANDIDATE = /[0-9A-Za-z+/=_-]{32,}/g;

/** Bits of information per character. Random keys score high; words and code score low. */
export function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function looksRandom(text: string): boolean {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((c) => c.test(text)).length;
  // Requiring all three character classes skips hex hashes and UUIDs (no capitals)
  // and long identifiers (rarely mixed with digits throughout).
  return classes === 3 && entropy(text) >= 4.2;
}

/** All secret-looking spans in the text, sorted and without overlaps. */
export function findSecrets(text: string): SecretMatch[] {
  const found: SecretMatch[] = [];
  for (const detector of DETECTORS) {
    for (const match of text.matchAll(detector.pattern)) {
      const group = detector.group ?? 0;
      const value = match[group];
      // Already scrubbed: `password: '[hidden]'` must not count as a secret again.
      if (value === undefined || value === REDACTED) continue;
      if (detector.kind === 'secret-assignment' && !SECRET_NAME.test(match[1] ?? '')) continue;
      const start = match.index + (group === 0 ? 0 : match[0].lastIndexOf(value));
      found.push({ kind: detector.kind, start, end: start + value.length });
    }
  }
  for (const match of text.matchAll(CANDIDATE)) {
    if (looksRandom(match[0])) {
      found.push({ kind: 'random-string', start: match.index, end: match.index + match[0].length });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: SecretMatch[] = [];
  for (const match of found) {
    const last = merged.at(-1);
    if (last && match.start < last.end) {
      last.end = Math.max(last.end, match.end);
      // Name the more specific kind when a known format overlaps a random-looking run.
      if (last.kind === 'random-string') last.kind = match.kind;
    } else {
      merged.push({ ...match });
    }
  }
  return merged;
}

/** Replaces every secret-looking span with `[hidden]`. */
export function scrub(text: string): string {
  let result = '';
  let cursor = 0;
  for (const match of findSecrets(text)) {
    result += text.slice(cursor, match.start) + REDACTED;
    cursor = match.end;
  }
  return result + text.slice(cursor);
}
