import { readOutputFile, writeOutputFile } from '../output/write.js';
import { cleanText } from './answers.js';
import type { ExplanationCache } from './types.js';

export const CACHE_FILE = 'explanations.json';

export function emptyCache(): ExplanationCache {
  return { version: 1, entries: {} };
}

/**
 * Loads saved explanations. The file lives in the user's project, so its
 * contents are checked and cleaned like a fresh answer; anything malformed is
 * dropped rather than trusted.
 */
export async function loadCache(root: string): Promise<ExplanationCache> {
  const text = await readOutputFile(root, CACHE_FILE);
  if (text === undefined) return emptyCache();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyCache();
  }
  const cache = emptyCache();
  const entries = (raw as { entries?: unknown } | null)?.entries;
  if (typeof entries !== 'object' || entries === null) return cache;
  for (const [id, entry] of Object.entries(entries)) {
    const { fingerprint, text: body } = (entry ?? {}) as Record<string, unknown>;
    if (typeof fingerprint === 'string' && typeof body === 'string' && cleanText(body)) {
      cache.entries[id] = { fingerprint, text: cleanText(body) };
    }
  }
  return cache;
}

export async function saveCache(root: string, cache: ExplanationCache): Promise<void> {
  const sorted = Object.fromEntries(
    Object.entries(cache.entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  await writeOutputFile(
    root,
    CACHE_FILE,
    `${JSON.stringify({ ...cache, entries: sorted }, null, 2)}\n`,
  );
}
