import { readOutputFile, writeOutputFile } from '../output/write.js';
import type { ExplainTask } from './types.js';

/** The connections in the last explain request, in the order they were numbered. */
export const REQUEST_FILE = 'request.json';

export async function saveRequest(root: string, tasks: readonly ExplainTask[]): Promise<void> {
  const connections = tasks.map(({ id, fingerprint }) => ({ id, fingerprint }));
  await writeOutputFile(
    root,
    REQUEST_FILE,
    `${JSON.stringify({ version: 1, connections }, null, 2)}\n`,
  );
}

/**
 * The connections the last request numbered, matched against the ones that
 * still need an explanation. A connection whose code changed since the
 * request, or one that is gone, comes back as undefined, so an answer
 * written for the old code is never saved for the new one.
 */
export async function loadRequest(
  root: string,
  pending: readonly ExplainTask[],
): Promise<(ExplainTask | undefined)[] | undefined> {
  const text = await readOutputFile(root, REQUEST_FILE);
  if (text === undefined) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const connections = (raw as { connections?: unknown } | null)?.connections;
  if (!Array.isArray(connections)) return undefined;
  const byId = new Map(pending.map((t) => [t.id, t]));
  return connections.map((entry: unknown) => {
    const { id, fingerprint } = (entry ?? {}) as Record<string, unknown>;
    const task = typeof id === 'string' ? byId.get(id) : undefined;
    return task?.fingerprint === fingerprint ? task : undefined;
  });
}
