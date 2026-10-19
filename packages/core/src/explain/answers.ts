import { assertNoSecrets } from '../safety/check.js';
import type { ExplainTask } from './types.js';

export const MAX_EXPLANATION_LENGTH = 600;

export interface ParsedAnswers {
  /** Accepted explanations by connection id. */
  accepted: Record<string, string>;
  /** Keys in the answer that weren't asked for, or had no usable text. */
  skipped: string[];
}

/** Plain text on one line: control characters removed, whitespace collapsed, length capped. */
export function cleanText(text: string): string {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const plain = text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, ' ');
  const collapsed = plain.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_EXPLANATION_LENGTH
    ? `${collapsed.slice(0, MAX_EXPLANATION_LENGTH - 1)}…`
    : collapsed;
}

/**
 * Reads Claude's answer, which maps each connection's number in the request
 * to its explanation. Only numbers that were asked about are kept, each
 * answer is cleaned to plain text, and if anything in it looks like a secret
 * the whole answer is refused so nothing is saved.
 *
 * `requested` is the request in order (number 1 first); an undefined entry is
 * a connection that changed since it was asked about, so its answer is skipped.
 */
export function parseAnswers(
  raw: string,
  requested: readonly (ExplainTask | undefined)[],
): ParsedAnswers {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`The answer is not valid JSON. It should look like { "1": "<explanation>" }.`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`The answer should be a JSON object like { "1": "<explanation>" }.`);
  }
  const accepted: Record<string, string> = {};
  const skipped: string[] = [];
  for (const [key, text] of Object.entries(value)) {
    const task = /^[1-9][0-9]*$/.test(key) ? requested[Number(key) - 1] : undefined;
    const clean = typeof text === 'string' ? cleanText(text) : '';
    if (!task || clean === '') {
      skipped.push(key);
      continue;
    }
    accepted[task.id] = clean;
  }
  assertNoSecrets(accepted);
  return { accepted, skipped };
}
