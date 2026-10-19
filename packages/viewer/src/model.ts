import type { Connection, FileNode, Graph, GraphNode, WebRoute } from '@grapher/core';

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
  /**
   * Extra boxes that stand for a node already on the canvas, keyed by the
   * box's id. Used when a file both uses and is used by the selected file, so
   * it can sit on both sides and every line still runs left to right.
   */
  copies?: Record<string, string>;
  /** Where to draw a connection when one of its ends is a copy. */
  ends?: Record<string, { from: string; to: string }>;
}

/** The id of the left-hand copy of a node that sits on both sides of the file view. */
export const usedByCopy = (id: string) => `${id}#used-by`;

/** Fast lookups over a graph, built once. */
export interface Index {
  graph: Graph;
  nodes: Map<string, GraphNode>;
  connections: Map<string, Connection>;
  /** Files nothing else in the code uses. See `unusedFiles`. */
  unused: Set<string>;
}

export function indexGraph(graph: Graph): Index {
  return {
    graph,
    nodes: new Map(graph.nodes.map((n) => [n.id, n])),
    connections: new Map(graph.connections.map((c) => [c.id, c])),
    unused: unusedFiles(graph),
  };
}

/** Files Next.js or a tool loads by name, so nothing in the code needs to import them. */
const ENTRY_ROLES: ReadonlySet<FileNode['role']> = new Set([
  'page',
  'layout',
  'route',
  'middleware',
  'config',
]);

// Special files Next.js picks up from the app folder, like loading.tsx or sitemap.ts.
const NEXT_SPECIAL_FILE =
  /^(?:src\/)?app\/(?:.*\/)?(?:loading|error|global-error|not-found|forbidden|unauthorized|default|template|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.[^/]+$/;
// Files run directly: a program's starting file, scripts, seeds, tests and stories.
const RUN_DIRECTLY = [
  /^(?:index|main|cli|server)\.[^/]+$/,
  /(?:^|\/)(?:src|bin)\/(?:index|main|cli|server)\.[^/]+$/,
  /(?:^|\/)(?:scripts|bin|e2e|tests?|__tests__|__mocks__)\//,
  /(?:^|\/)seed\.[^/]+$/,
  /\.(?:test|spec|stories)\.[^/]+$/,
  // Browser scripts a web page loads with a <script> tag, not an import.
  /(?:^|\/)(?:public|static|assets|resources)\//,
  /\.min\.js$/,
];

// Only JavaScript and TypeScript are read closely enough to trust "nothing
// uses it". Other languages get a basic map that misses links like Java
// classes in the same package or Go files in the same folder.
const FULLY_READ = /\.(?:[cm]?[jt]sx?)$/;

/**
 * True for files that are meant to be started from outside the code, so it's
 * normal that nothing imports them: pages, routes, layouts, config, scripts,
 * tests and browser scripts. Files in other languages count too, because
 * Grapher can't yet tell for sure that nothing uses them.
 */
export function isEntryPoint(node: FileNode): boolean {
  return (
    !FULLY_READ.test(node.path) ||
    ENTRY_ROLES.has(node.role) ||
    NEXT_SPECIAL_FILE.test(node.path) ||
    RUN_DIRECTLY.some((pattern) => pattern.test(node.path))
  );
}

/**
 * JavaScript and TypeScript files nothing else uses: no other file imports,
 * displays, requests or links to them, and they aren't an entry point. Code loaded in ways Grapher can't
 * see (like a path built at runtime) can still show up here, so the viewer
 * calls these "unused", not "safe to delete".
 */
export function unusedFiles(graph: Graph): Set<string> {
  const used = new Set(graph.connections.filter((c) => c.from !== c.to).map((c) => c.to));
  return new Set(
    graph.nodes
      .filter((n): n is FileNode => n.kind === 'file' && !isEntryPoint(n) && !used.has(n.id))
      .map((n) => n.id),
  );
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

/** `GET, POST /users`, or just the path when any method is accepted. */
function routeText(route: WebRoute): string {
  return route.methods.length > 0 ? `${route.methods.join(', ')} ${route.path}` : route.path;
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
          if (node.routes && node.routes.length > 1) {
            const shown = node.routes.slice(0, 2).map(routeText).join(', ');
            const more = node.routes.length - 2;
            return `Web routes: ${shown}${more > 0 ? ` and ${more} more` : ''}`;
          }
          if (node.routes?.length === 1 && node.routes[0]) {
            return `Web route: ${routeText(node.routes[0])}`;
          }
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
      // A file that goes both ways (the home page displays the footer, and the
      // footer links back to the home page) gets a copy on the "Used by" side,
      // so its two lines don't run over each other.
      const usedIds = new Set(outgoing.map((c) => c.to));
      const copies: Record<string, string> = {};
      const ends: Record<string, { from: string; to: string }> = {};
      const left = incoming.map((c) => {
        if (!usedIds.has(c.from)) return c.from;
        const copy = usedByCopy(c.from);
        copies[copy] = c.from;
        ends[c.id] = { from: copy, to: c.to };
        return copy;
      });
      const columns: Column[] = [];
      if (incoming.length > 0) columns.push({ heading: 'Used by', nodes: left });
      columns.push({ heading: isOutside(node) ? 'Selected' : 'Selected file', nodes: [id] });
      if (outgoing.length > 0) {
        columns.push({ heading: 'Uses and talks to', nodes: outgoing.map((c) => c.to) });
      }
      return {
        title: nodeName(node),
        subtitle: index.unused.has(id)
          ? `${describeNode(node)}. Nothing in your code uses this file.`
          : describeNode(node),
        columns,
        connections: [...incoming, ...outgoing],
        labels: true,
        copies,
        ends,
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
