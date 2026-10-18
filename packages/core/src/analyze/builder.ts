import {
  type Connection,
  type ConnectionKind,
  GRAPH_SCHEMA_VERSION,
  type Graph,
  type GraphNode,
  type GraphWarning,
  type Location,
} from '../graph/types.js';
import { joinAnd, listNames } from './labels.js';

/** Database operations, as beginners would describe them. */
export type DbOperation = 'reads' | 'saves' | 'deletes' | 'runs';

export interface ConnectionInput {
  from: string;
  to: string;
  kind: ConnectionKind;
  location: Location;
  /** For `uses`: the imported names this file actually uses. */
  name?: string;
  /** For `requests`: the HTTP method. For database connections: the table. */
  detail?: string;
  /** For database connections. */
  operation?: DbOperation;
}

interface Draft {
  from: string;
  to: string;
  kinds: Set<ConnectionKind>;
  names: Set<string>;
  details: Set<string>;
  operations: Set<DbOperation>;
  locations: Map<string, Location>;
}

const MAX_LOCATIONS = 5;
const OPERATION_ORDER: DbOperation[] = ['reads', 'saves', 'deletes', 'runs'];
const PREPOSITION: Record<DbOperation, string> = {
  reads: 'reads from',
  saves: 'saves to',
  deletes: 'deletes from',
  runs: 'runs',
};

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Collects nodes and connections while detectors run, then produces a
 * stable, sorted graph. There is at most one connection per pair of nodes;
 * everything detected between the same pair is merged into it.
 */
export class GraphBuilder {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly drafts = new Map<string, Draft>();
  private readonly unknownPackages = new Set<string>();
  private readonly warnings: GraphWarning[] = [];

  addNode(node: GraphNode): void {
    if (!this.nodes.has(node.id)) this.nodes.set(node.id, node);
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  addUnknownPackage(name: string): void {
    this.unknownPackages.add(name);
  }

  warn(warning: GraphWarning): void {
    this.warnings.push(warning);
  }

  connect(input: ConnectionInput): void {
    if (input.from === input.to) return;
    const key = `${input.from}->${input.to}`;
    let draft = this.drafts.get(key);
    if (!draft) {
      draft = {
        from: input.from,
        to: input.to,
        kinds: new Set(),
        names: new Set(),
        details: new Set(),
        operations: new Set(),
        locations: new Map(),
      };
      this.drafts.set(key, draft);
    }
    draft.kinds.add(input.kind);
    if (input.name !== undefined) draft.names.add(input.name);
    if (input.detail !== undefined) draft.details.add(input.detail);
    if (input.operation !== undefined) draft.operations.add(input.operation);
    const { path, line, role } = input.location;
    draft.locations.set(`${path}:${String(line)}:${role}`, input.location);
  }

  build(project: Graph['project']): Graph {
    const nodes = [...this.nodes.values()].sort((a, b) => byString(a.id, b.id));
    const connections = [...this.drafts.entries()]
      .sort(([a], [b]) => byString(a, b))
      .map(([id, draft]) => this.finish(id, draft));
    return {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      project,
      nodes,
      connections,
      unknownPackages: [...this.unknownPackages].sort(byString),
      warnings: this.warnings,
    };
  }

  private finish(id: string, draft: Draft): Connection {
    const kind = this.mainKind(draft.kinds);
    const details = [...draft.details].sort(byString);
    const locations = [...draft.locations.values()]
      .sort((a, b) => byString(a.path, b.path) || a.line - b.line || byString(a.role, b.role))
      .slice(0, MAX_LOCATIONS);
    const connection: Connection = {
      id,
      from: draft.from,
      to: draft.to,
      kind,
      label: this.label(kind, draft, details),
      locations,
    };
    if (details.length > 0) connection.details = details;
    return connection;
  }

  /** When one pair has several kinds, the most informative wins. */
  private mainKind(kinds: Set<ConnectionKind>): ConnectionKind {
    const order: ConnectionKind[] = [
      'writes',
      'reads',
      'requests',
      'displays',
      'links',
      'connects',
      'uses-service',
      'reads-setting',
      'uses',
    ];
    return order.find((k) => kinds.has(k)) ?? 'uses';
  }

  private label(kind: ConnectionKind, draft: Draft, details: string[]): string {
    switch (kind) {
      case 'displays':
        return 'displays';
      case 'links':
        return 'sends the user to';
      case 'uses': {
        const names = [...draft.names].sort(byString);
        return names.length > 0 ? `uses ${listNames(names)}` : 'imports but never uses';
      }
      case 'requests':
        return details.length === 1
          ? `sends a ${details[0] ?? ''} request to`
          : details.length > 1
            ? `sends ${joinAnd(details)} requests to`
            : 'sends a request to';
      case 'reads':
      case 'writes': {
        const operations = OPERATION_ORDER.filter((op) => draft.operations.has(op));
        const verb =
          operations.length === 1 ? PREPOSITION[operations[0] ?? 'reads'] : joinAnd(operations);
        // Tables first, then database functions like `get_leaderboard()`.
        const names = [...details].sort(
          (a, b) => Number(a.endsWith('()')) - Number(b.endsWith('()')) || byString(a, b),
        );
        return names.length > 0 ? `${verb} ${listNames(names, 3)}` : verb;
      }
      case 'connects':
        return 'connects to';
      case 'uses-service': {
        const target = this.nodes.get(draft.to);
        if (target?.kind !== 'service') return 'uses service';
        return target.unidentified === true
          ? `uses the ${target.label} package`
          : `uses ${target.label}`;
      }
      case 'reads-setting':
        return 'reads setting';
    }
  }
}
