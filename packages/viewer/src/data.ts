import type { Connection, Graph, GraphNode, ViewerData, WebRoute } from '@grapher/core';

const NODE_KINDS = new Set(['file', 'database', 'service', 'setting']);
const FRAMEWORKS = new Set(['next-app-router', 'flask', 'fastapi', 'django']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function isNode(value: unknown): value is GraphNode {
  return isRecord(value) && typeof value.id === 'string' && NODE_KINDS.has(value.kind as string);
}

/** Keeps only well-formed web routes on a file node, so the text built from them can't break. */
function cleanRoutes(node: GraphNode): GraphNode {
  if (node.kind !== 'file' || node.routes === undefined) return node;
  const routes: unknown = node.routes;
  const clean = Array.isArray(routes)
    ? routes.filter(
        (r): r is WebRoute => isRecord(r) && typeof r.path === 'string' && isStringArray(r.methods),
      )
    : [];
  return { ...node, routes: clean };
}

function isConnection(value: unknown): value is Connection {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.from === 'string' &&
    typeof value.to === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.label === 'string' &&
    Array.isArray(value.locations)
  );
}

/**
 * Checks the embedded data has the shape the viewer expects. It came from the
 * user's project, so it's treated as untrusted: malformed parts are dropped
 * instead of crashing the page. React escapes every string it renders.
 */
export function parseViewerData(raw: unknown): ViewerData | undefined {
  if (!isRecord(raw) || !isRecord(raw.graph)) return undefined;
  const graph = raw.graph;
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.connections)) return undefined;
  const nodes = graph.nodes.filter(isNode).map(cleanRoutes);
  const ids = new Set(nodes.map((n) => n.id));
  const connections = graph.connections
    .filter(isConnection)
    .filter((c) => ids.has(c.from) && ids.has(c.to));
  const project = isRecord(graph.project) ? graph.project : {};
  const parsed: Graph = {
    schemaVersion: 1,
    project: {
      name: typeof project.name === 'string' ? project.name : 'project',
      framework: FRAMEWORKS.has(project.framework as string)
        ? (project.framework as Graph['project']['framework'])
        : 'unknown',
    },
    nodes,
    connections,
    unknownPackages: isStringArray(graph.unknownPackages) ? graph.unknownPackages : [],
    warnings: Array.isArray(graph.warnings)
      ? graph.warnings.filter(
          (w): w is Graph['warnings'][number] => isRecord(w) && typeof w.message === 'string',
        )
      : [],
  };
  return {
    graph: parsed,
    root: typeof raw.root === 'string' ? raw.root : '',
    protectedFiles: isStringArray(raw.protectedFiles) ? raw.protectedFiles : [],
    explanations: stringRecord(raw.explanations),
  };
}

/** Reads the data Grapher embedded in the page. */
export function loadViewerData(doc: Document): ViewerData | undefined {
  const text = doc.getElementById('grapher-data')?.textContent;
  if (!text) return undefined;
  try {
    return parseViewerData(JSON.parse(text));
  } catch {
    return undefined;
  }
}
