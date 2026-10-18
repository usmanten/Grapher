/**
 * The shape of graph.json. Bump GRAPH_SCHEMA_VERSION on any breaking change,
 * and keep schema/graph.schema.json in sync.
 */
export const GRAPH_SCHEMA_VERSION = 1;

/** What a file does in a Next.js app, decided from its path and contents. */
export type FileRole =
  'page' | 'layout' | 'route' | 'middleware' | 'server-actions' | 'component' | 'module' | 'config';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface FileNode {
  /** `file:<path>` */
  id: string;
  kind: 'file';
  /** Path relative to the project root, with forward slashes. */
  path: string;
  role: FileRole;
  /** The URL this page or route answers, like `/api/users/[id]`. */
  urlPath?: string;
  /** HTTP methods an API route handles. */
  methods?: HttpMethod[];
  /** True if the file starts with 'use client', so it runs in the browser. */
  client?: boolean;
}

export interface DatabaseNode {
  /** `database:<engine>` */
  id: string;
  kind: 'database';
  /** A display name, like "Postgres". */
  label: string;
  /** How the code talks to it, like "Prisma". */
  via?: string;
  /** True if the database was guessed from a package name rather than its client code. */
  inferred?: boolean;
  /** Set when Claude identified the package by its name, because Grapher didn't know it. */
  identifiedBy?: 'ai';
}

export interface ServiceNode {
  /** `service:<package or host>` */
  id: string;
  kind: 'service';
  label: string;
  /** The npm package or web host that identified it. */
  source: string;
  /** Set when Claude identified the package by its name, because Grapher didn't know it. */
  identifiedBy?: 'ai';
  /** True for a package nobody has identified yet. It may or may not talk to anything outside the app. */
  unidentified?: boolean;
}

export interface SettingNode {
  /** `setting:<NAME>` */
  id: string;
  kind: 'setting';
  /** The environment variable name. Values are never recorded. */
  name: string;
  /** True for NEXT_PUBLIC_ settings, which are visible in the browser. */
  public: boolean;
}

export type GraphNode = FileNode | DatabaseNode | ServiceNode | SettingNode;

export type ConnectionKind =
  | 'displays'
  | 'uses'
  | 'requests'
  | 'links'
  | 'reads'
  | 'writes'
  | 'connects'
  | 'uses-service'
  | 'reads-setting';

/** A line of code that proves a connection exists. */
export interface Location {
  path: string;
  line: number;
  /** What happens on this line. */
  role: 'import' | 'use';
  /** The line of code itself, trimmed and with anything secret-looking replaced by `[hidden]`. */
  code?: string;
}

export interface Connection {
  /** `<from>-><to>`. There is at most one connection per pair of nodes. */
  id: string;
  from: string;
  to: string;
  kind: ConnectionKind;
  /** A short plain-English label, like "uses sendWelcomeEmail" or "saves to users". */
  label: string;
  /** Table names for database connections, HTTP methods for requests. */
  details?: string[];
  locations: Location[];
}

export interface GraphWarning {
  code: 'pages-router' | 'no-app-router' | 'truncated' | 'parse-error';
  message: string;
}

export interface Graph {
  schemaVersion: typeof GRAPH_SCHEMA_VERSION;
  project: {
    name: string;
    framework: 'next-app-router' | 'unknown';
  };
  nodes: GraphNode[];
  connections: Connection[];
  /** Imported packages Grapher doesn't recognize, to be classified later by name only. */
  unknownPackages: string[];
  warnings: GraphWarning[];
}
