import { assertNoSecrets } from '../safety/check.js';
import type { ExplainTask } from './types.js';

export const MAX_EXPLANATION_LENGTH = 600;

export interface ParsedAnswers {
  /** Accepted explanations by connection id. */
  accepted: Record<string, string>;
  /** Ids that were in the answer but not asked for, or had no usable text. */
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
 * Reads Claude's answer. Only ids that were asked for are kept, each answer is
 * cleaned to plain text, and if anything in it looks like a secret the whole
 * answer is refused so nothing is saved.
 */
export function parseAnswers(raw: string, tasks: readonly ExplainTask[]): ParsedAnswers {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(
      `The answer is not valid JSON. It should look like { "<id>": "<explanation>" }.`,
    );
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`The answer should be a JSON object like { "<id>": "<explanation>" }.`);
  }
  const asked = new Set(tasks.map((t) => t.id));
  const accepted: Record<string, string> = {};
  const skipped: string[] = [];
  for (const [id, text] of Object.entries(value)) {
    const clean = typeof text === 'string' ? cleanText(text) : '';
    if (!asked.has(id) || clean === '') {
      skipped.push(id);
      continue;
    }
    accepted[id] = clean;
  }
  assertNoSecrets(accepted);
  return { accepted, skipped };
}
