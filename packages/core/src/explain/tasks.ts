import { createHash } from 'node:crypto';

import type { Connection, Graph, GraphNode } from '../graph/types.js';
import type { ExplainTask, ExplanationCache } from './types.js';

function nodeName(node: GraphNode): string {
  switch (node.kind) {
    case 'file':
      return node.path;
    case 'setting':
      return node.name;
    case 'database':
    case 'service':
      return node.label;
  }
}

function nodeIs(node: GraphNode): string {
  switch (node.kind) {
    case 'file': {
      const routes = node.routes?.map((r) => `${r.methods.join(', ')} ${r.path}`.trim());
      const where =
        routes && routes.length > 1
          ? ` for ${routes.slice(0, 5).join('; ')}${routes.length > 5 ? ' and more' : ''}`
          : node.urlPath
            ? ` for ${node.urlPath}`
            : '';
      const runs = node.client ? ', runs in the browser' : '';
      return `${node.role}${where}${runs}`;
    }
    case 'database':
      return node.via ? `database, used through ${node.via}` : 'database';
    case 'service':
      return node.unidentified === true
        ? 'package nobody has identified yet; it may or may not talk to anything outside the app'
        : 'outside service';
    case 'setting':
      return node.public ? 'setting visible in the browser' : 'secret setting (value never shown)';
  }
}

/**
 * Identifies what an explanation was written for. If the connection's kind,
 * label, tables or code lines change, the fingerprint changes and the
 * explanation is written again; otherwise the cached one is reused.
 */
export function fingerprint(connection: Connection): string {
  const parts = [
    connection.kind,
    connection.from,
    connection.to,
    connection.label,
    ...(connection.details ?? []),
    ...connection.locations.map((l) => `${l.path}\n${l.code ?? ''}`),
  ];
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 16);
}

/** Connections that have no up-to-date explanation in the cache, in graph order. */
export function explainTasks(graph: Graph, cache: ExplanationCache): ExplainTask[] {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const tasks: ExplainTask[] = [];
  for (const connection of graph.connections) {
    const from = nodes.get(connection.from);
    const to = nodes.get(connection.to);
    if (!from || !to) continue;
    const print = fingerprint(connection);
    if (cache.entries[connection.id]?.fingerprint === print) continue;
    const task: ExplainTask = {
      id: connection.id,
      fingerprint: print,
      from: { name: nodeName(from), is: nodeIs(from) },
      to: { name: nodeName(to), is: nodeIs(to) },
      label: connection.label,
      code: connection.locations.flatMap((l) =>
        l.code ? [{ path: l.path, line: l.line, code: l.code }] : [],
      ),
    };
    if (connection.details) task.details = connection.details;
    tasks.push(task);
  }
  return tasks;
}

/** Explanations that still match the current graph, keyed by connection id. */
export function currentExplanations(graph: Graph, cache: ExplanationCache): Record<string, string> {
  const result: Record<string, string> = {};
  for (const connection of graph.connections) {
    const entry = cache.entries[connection.id];
    if (entry?.fingerprint === fingerprint(connection)) result[connection.id] = entry.text;
  }
  return result;
}
