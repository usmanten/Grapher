import type { Connection, Graph, GraphNode } from '@grapher/core';

/** The three ways to look at a project. */
export type View = 'file' | 'flow' | 'overview';

/** Color group for a node, matching the CSS variables `--k-<group>`. */
export type KindGroup =
  'page' | 'component' | 'route' | 'lib' | 'db' | 'service' | 'package' | 'setting';

export interface Column {
  heading: string;
  nodes: string[];
}

export interface Layout {
  title: string;
  subtitle: string;
  columns: Column[];
  connections: Connection[];
  /** Whether to label every line. The overview hides labels to stay readable. */
  labels: boolean;
}

/** Fast lookups over a graph, built once. */
export interface Index {
  graph: Graph;
  nodes: Map<string, GraphNode>;
  connections: Map<string, Connection>;
}

export function indexGraph(graph: Graph): Index {
  return {
    graph,
    nodes: new Map(graph.nodes.map((n) => [n.id, n])),
    connections: new Map(graph.connections.map((c) => [c.id, c])),
  };
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The short name shown on a node's box. */
export function nodeName(node: GraphNode): string {
  switch (node.kind) {
    case 'file':
      return node.path;
    case 'database':
      return node.label;
    case 'service':
      return node.label;
    case 'setting':
      return node.name;
  }
}

/** A shorter name for sentences and headings: files by their last two path parts. */
export function shortName(node: GraphNode): string {
  if (node.kind !== 'file') return nodeName(node);
  const parts = node.path.split('/');
  return parts.slice(-2).join('/');
}

export function kindGroup(node: GraphNode): KindGroup {
  switch (node.kind) {
    case 'database':
      return 'db';
    case 'service':
      return node.unidentified === true ? 'package' : 'service';
    case 'setting':
      return 'setting';
    case 'file':
      if (node.role === 'page' || node.role === 'layout') return 'page';
      if (node.role === 'route' || node.role === 'server-actions') return 'route';
      if (node.role === 'component') return 'component';
      return 'lib';
  }
}

/** One line describing what a node is, in plain words. */
export function describeNode(node: GraphNode): string {
  switch (node.kind) {
    case 'database': {
      const base = node.via ? `Database, used through ${node.via}` : 'Database';
      return node.identifiedBy === 'ai' ? `${base}, identified by AI` : base;
    }
    case 'service':
      if (node.unidentified === true) return 'Package, not yet identified';
      return node.identifiedBy === 'ai' ? 'Outside service, identified by AI' : 'Outside service';
    case 'setting':
      return node.public ? 'Setting, visible in the browser' : 'Setting, value hidden';
    case 'file':
      switch (node.role) {
        case 'page':
          return `Page at ${node.urlPath ?? '/'}`;
        case 'layout':
          return 'Layout around pages';
        case 'route': {
          const methods = node.methods?.join(', ');
          const url = node.urlPath ?? '';
          return methods ? `API route: ${methods} ${url}` : `API route at ${url}`;
        }
        case 'server-actions':
          return 'Server actions';
        case 'middleware':
          return 'Middleware, runs before requests';
        case 'config':
          return 'Configuration';
        case 'component':
          return node.client ? 'Component, runs in the browser' : 'Component';
        case 'module':
          return 'Shared code';
      }
  }
}

/** True for nodes that live outside the user's own files. */
export function isOutside(node: GraphNode): boolean {
  return node.kind !== 'file';
}

/** A sentence describing a connection, built from what the analysis found. */
export function describeConnection(index: Index, connection: Connection): string {
  const from = index.nodes.get(connection.from);
  const to = index.nodes.get(connection.to);
  if (!from || !to) return '';
  const a = shortName(from);
  const b = shortName(to);
  switch (connection.kind) {
    case 'displays':
      return `${a} displays the ${b} component on screen.`;
    case 'links':
      return `${a} sends the user to the ${b} page${to.kind === 'file' && to.urlPath ? ` (${to.urlPath})` : ''}, with a link or a redirect.`;
    case 'requests':
      return `${a} sends a request to the API route in ${b}${to.kind === 'file' && to.urlPath ? ` (${to.urlPath})` : ''}. This is where the browser talks to your server.`;
    case 'reads':
    case 'writes':
      return `${a} ${connection.label} in ${b}.`;
    case 'connects':
      return `${a} connects to ${b}.`;
    case 'uses-service':
      return to.kind === 'service' && to.unidentified === true
        ? `${a} uses the ${b} package. Grapher doesn't know yet whether it talks to anything outside your app.`
        : `${a} uses ${b}, a service outside your code.`;
    case 'reads-setting':
      return `${a} reads the ${b} setting. Grapher shows only the setting's name, never its value.`;
    case 'uses':
      return `${a} ${connection.label} from ${b}.`;
  }
}

function neighbors(index: Index, start: string, direction: 'in' | 'out'): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const c of index.graph.connections) {
      const [a, b] = direction === 'out' ? [c.from, c.to] : [c.to, c.from];
      if (a === current && !seen.has(b)) {
        seen.add(b);
        queue.push(b);
      }
    }
  }
  return seen;
}

/**
 * Puts each node in a column by its longest path from a starting node, so
 * lines mostly flow left to right. Cycles are cut off after one pass per node.
 */
export function rankColumns(
  nodes: ReadonlySet<string>,
  connections: readonly Connection[],
): string[][] {
  const rank = new Map<string, number>();
  for (const n of nodes) rank.set(n, 0);
  for (let i = 0; i < nodes.size; i++) {
    let changed = false;
    for (const c of connections) {
      const next = (rank.get(c.from) ?? 0) + 1;
      if (next > (rank.get(c.to) ?? 0) && next < nodes.size) {
        rank.set(c.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const columns: string[][] = [];
  for (const n of [...nodes].sort()) {
    const r = rank.get(n) ?? 0;
    (columns[r] ??= []).push(n);
  }
  return columns.filter((c) => c.length > 0);
}

/** Decides which nodes and lines to show for the current view. */
export function layoutFor(index: Index, view: View, focus: string | undefined): Layout {
  const node = focus === undefined ? undefined : index.nodes.get(focus);
  if (view !== 'overview' && node) {
    const id = node.id;
    if (view === 'file') {
      const incoming = index.graph.connections.filter((c) => c.to === id);
      const outgoing = index.graph.connections.filter((c) => c.from === id);
      const columns: Column[] = [];
      if (incoming.length > 0)
        columns.push({ heading: 'Used by', nodes: incoming.map((c) => c.from) });
      columns.push({ heading: isOutside(node) ? 'Selected' : 'Selected file', nodes: [id] });
      if (outgoing.length > 0) {
        columns.push({ heading: 'Uses and talks to', nodes: outgoing.map((c) => c.to) });
      }
      return {
        title: nodeName(node),
        subtitle: describeNode(node),
        columns,
        connections: [...incoming, ...outgoing],
        labels: true,
      };
    }
    const set = new Set([...neighbors(index, id, 'in'), ...neighbors(index, id, 'out')]);
    const connections = index.graph.connections.filter((c) => set.has(c.from) && set.has(c.to));
    return {
      title: `Full flow through ${shortName(node)}`,
      subtitle: 'Everything that leads here, and everything it leads to.',
      columns: rankColumns(set, connections).map((nodes) => ({ heading: '', nodes })),
      connections,
      labels: true,
    };
  }
  const all = new Set(index.graph.nodes.map((n) => n.id));
  return {
    title: 'Overview',
    subtitle: 'Every file and outside service. Click a line to see what it does.',
    columns: rankColumns(all, index.graph.connections).map((nodes) => ({ heading: '', nodes })),
    connections: index.graph.connections,
    labels: false,
  };
}

/** The file Grapher starts on: the home page if there is one, else the first page or file. */
export function defaultFocus(graph: Graph): string | undefined {
  const files = graph.nodes.filter((n) => n.kind === 'file');
  const pages = files.filter((n) => n.role === 'page');
  return (
    pages.find((n) => n.urlPath === '/')?.id ??
    pages[0]?.id ??
    files.find((n) => graph.connections.some((c) => c.from === n.id))?.id ??
    graph.nodes[0]?.id
  );
}

/** A connection to show when a node is selected: keep the current one if it still touches the node. */
export function connectionFor(
  index: Index,
  focus: string,
  current: string | undefined,
): string | undefined {
  const kept = current === undefined ? undefined : index.connections.get(current);
  if (kept && (kept.from === focus || kept.to === focus)) return kept.id;
  return (
    index.graph.connections.find((c) => c.from === focus)?.id ??
    index.graph.connections.find((c) => c.to === focus)?.id
  );
}

export interface TreeFolder {
  name: string;
  folders: TreeFolder[];
  files: { id: string; name: string }[];
}

/** Groups file nodes into folders for the side panel. */
export function fileTree(graph: Graph): TreeFolder {
  const root: TreeFolder = { name: '', folders: [], files: [] };
  for (const node of graph.nodes) {
    if (node.kind !== 'file') continue;
    const parts = node.path.split('/');
    const file = parts.pop() ?? node.path;
    let folder = root;
    for (const part of parts) {
      let next = folder.folders.find((f) => f.name === part);
      if (!next) {
        next = { name: part, folders: [], files: [] };
        folder.folders.push(next);
      }
      folder = next;
    }
    folder.files.push({ id: node.id, name: file });
  }
  const sort = (folder: TreeFolder): void => {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name));
    folder.files.sort((a, b) => a.name.localeCompare(b.name));
    folder.folders.forEach(sort);
  };
  sort(root);
  return root;
}

/**
 * A link that opens a file at a line in VS Code. Each path part is encoded,
 * so a crafted file name can't change what the link does.
 */
export function editorLink(root: string, path: string, line: number): string {
  const full = `${root.replace(/\\/g, '/').replace(/\/+$/, '')}/${path}`;
  const encoded = full
    .split('/')
    .map((part) => (/^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)))
    .join('/');
  return `vscode://file${encoded.startsWith('/') ? '' : '/'}${encoded}:${line}`;
}
