import { type CallExpression, type Node, SyntaxKind } from 'ts-morph';

import type { DbOperation, GraphBuilder } from '../builder.js';
import { pluralize } from '../labels.js';
import type { AnalysisContext, AnalyzedFile } from '../project.js';
import { at, chainRoot, declarationOf, stringValue } from './shared.js';

interface Engine {
  id: string;
  label: string;
  via: string;
}

const PRISMA_PROVIDERS: Record<string, string> = {
  postgresql: 'Postgres',
  postgres: 'Postgres',
  mysql: 'MySQL',
  sqlite: 'SQLite',
  sqlserver: 'SQL Server',
  mongodb: 'MongoDB',
  cockroachdb: 'CockroachDB',
};

const PRISMA_OPERATIONS: Record<string, DbOperation> = {
  findMany: 'reads',
  findUnique: 'reads',
  findUniqueOrThrow: 'reads',
  findFirst: 'reads',
  findFirstOrThrow: 'reads',
  count: 'reads',
  aggregate: 'reads',
  groupBy: 'reads',
  create: 'saves',
  createMany: 'saves',
  createManyAndReturn: 'saves',
  update: 'saves',
  updateMany: 'saves',
  upsert: 'saves',
  delete: 'deletes',
  deleteMany: 'deletes',
};

const DRIZZLE_DRIVERS: Record<string, string> = {
  'node-postgres': 'Postgres',
  'postgres-js': 'Postgres',
  'neon-http': 'Postgres',
  'neon-serverless': 'Postgres',
  'vercel-postgres': 'Postgres',
  pglite: 'Postgres',
  'aws-data-api': 'Postgres',
  mysql2: 'MySQL',
  'planetscale-serverless': 'MySQL',
  'better-sqlite3': 'SQLite',
  libsql: 'SQLite',
  d1: 'SQLite',
  'bun-sqlite': 'SQLite',
};

const SUPABASE_PACKAGES = new Set([
  '@supabase/supabase-js',
  '@supabase/ssr',
  '@supabase/auth-helpers-nextjs',
]);
const SUPABASE_CLIENT_FACTORIES = new Set([
  'createClient',
  'createServerClient',
  'createBrowserClient',
  'createServerComponentClient',
  'createClientComponentClient',
  'createRouteHandlerClient',
]);
const SUPABASE_OPERATIONS: Record<string, DbOperation> = {
  select: 'reads',
  insert: 'saves',
  update: 'saves',
  upsert: 'saves',
  delete: 'deletes',
};

function addEngine(builder: GraphBuilder, engine: Engine): void {
  builder.addNode({ id: engine.id, kind: 'database', label: engine.label, via: engine.via });
}

function connectTable(
  builder: GraphBuilder,
  file: AnalyzedFile,
  engine: Engine,
  node: Node,
  table: string,
  operation: DbOperation,
): void {
  addEngine(builder, engine);
  builder.connect({
    from: file.nodeId,
    to: engine.id,
    kind: operation === 'reads' ? 'reads' : 'writes',
    operation,
    detail: table,
    location: at(file, node, 'use'),
  });
}

/** Declarations whose value is built by a call or `new` matching `isFactory`. */
function clientDeclarations(
  ctx: AnalysisContext,
  isFactory: (node: Node) => boolean,
  onClient: (file: AnalyzedFile, creation: Node) => void,
): Set<Node> {
  const declarations = new Set<Node>();
  for (const file of ctx.files.values()) {
    const creations = [
      ...file.source.getDescendantsOfKind(SyntaxKind.NewExpression),
      ...file.source.getDescendantsOfKind(SyntaxKind.CallExpression),
    ].filter(isFactory);
    for (const creation of creations) {
      onClient(file, creation);
      const decl = creation.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      if (decl) declarations.add(decl);
    }
  }
  return declarations;
}

function rootIsClient(node: Node, clients: Set<Node>): boolean {
  const root = chainRoot(node);
  const decl = root ? declarationOf(root) : undefined;
  return decl !== undefined && clients.has(decl);
}

interface PrismaSchema {
  engine: Engine;
  /** Where the schema is, and which settings its datasource reads, with line numbers. */
  path?: string;
  settings: { name: string; line: number }[];
}

async function readPrismaSchema(ctx: AnalysisContext): Promise<PrismaSchema> {
  const path = ['prisma/schema.prisma', 'schema.prisma'].find((p) =>
    ctx.scan.files.some((f) => f.path === p),
  );
  let label = 'Database';
  const settings: PrismaSchema['settings'] = [];
  if (path !== undefined) {
    const schema = await ctx.reader.read(path);
    const datasource = /datasource\s+\w+\s*\{([^}]*)\}/.exec(schema)?.[1] ?? '';
    const provider = /provider\s*=\s*"([^"]+)"/.exec(datasource)?.[1];
    if (provider !== undefined) label = PRISMA_PROVIDERS[provider] ?? label;
    const lines = schema.split('\n');
    for (const match of datasource.matchAll(/env\(\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*\)/g)) {
      const name = match[1];
      if (name === undefined) continue;
      const line = lines.findIndex((l) => l.includes(`env("${name}")`)) + 1;
      settings.push({ name, line: Math.max(line, 1) });
    }
  }
  const engine = {
    id: `database:${label.toLowerCase().replace(/\s+/g, '-')}`,
    label,
    via: 'Prisma',
  };
  return path === undefined ? { engine, settings } : { engine, path, settings };
}

/**
 * Prisma: finds `new PrismaClient()`, then calls like `db.user.create()` on
 * that client, wherever it is imported.
 */
export async function detectPrisma(
  ctx: AnalysisContext,
  builder: GraphBuilder,
  connectSetting: (from: string, name: string, path: string, line: number) => void,
): Promise<void> {
  const creations: { file: AnalyzedFile; node: Node }[] = [];
  const clients = clientDeclarations(
    ctx,
    (node) =>
      node.isKind(SyntaxKind.NewExpression) && node.getExpression().getText() === 'PrismaClient',
    (file, node) => creations.push({ file, node }),
  );
  if (creations.length === 0) return;

  const schema = await readPrismaSchema(ctx);
  const { engine } = schema;
  addEngine(builder, engine);
  for (const { file, node } of creations) {
    builder.connect({
      from: file.nodeId,
      to: engine.id,
      kind: 'connects',
      location: at(file, node, 'use'),
    });
  }

  // The schema says which setting holds the connection address.
  if (schema.path !== undefined && schema.settings.length > 0) {
    const fromId = `file:${schema.path}`;
    builder.addNode({ id: fromId, kind: 'file', path: schema.path, role: 'config' });
    for (const { name, line } of schema.settings) connectSetting(fromId, name, schema.path, line);
  }

  for (const file of ctx.files.values()) {
    for (const call of file.source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      if (!callee.isKind(SyntaxKind.PropertyAccessExpression)) continue;
      const operation = PRISMA_OPERATIONS[callee.getName()];
      const model = callee.getExpression();
      if (operation === undefined || !model.isKind(SyntaxKind.PropertyAccessExpression)) continue;
      if (!rootIsClient(model.getExpression(), clients)) continue;
      connectTable(builder, file, engine, call, pluralize(model.getName()), operation);
    }
  }
}

function drizzleTable(node: Node | undefined): string | undefined {
  if (node?.isKind(SyntaxKind.Identifier)) return node.getText();
  if (node?.isKind(SyntaxKind.PropertyAccessExpression)) return node.getName();
  return undefined;
}

/**
 * Drizzle: finds `drizzle(...)` from a drizzle-orm driver, then
 * `db.select().from(users)`, `db.insert(users)`, `db.query.users.findMany()`
 * and similar calls on that client.
 */
export function detectDrizzle(ctx: AnalysisContext, builder: GraphBuilder): void {
  const engines = new Map<Node, Engine>();
  const clients = new Set<Node>();
  for (const file of ctx.files.values()) {
    for (const decl of file.source.getImportDeclarations()) {
      const spec = decl.getModuleSpecifierValue();
      if (!spec.startsWith('drizzle-orm/')) continue;
      const driver = spec.slice('drizzle-orm/'.length);
      const label = DRIZZLE_DRIVERS[driver];
      const local =
        decl
          .getNamedImports()
          .find((n) => n.getName() === 'drizzle')
          ?.getAliasNode()
          ?.getText() ??
        (decl.getNamedImports().some((n) => n.getName() === 'drizzle') ? 'drizzle' : undefined);
      if (label === undefined || local === undefined) continue;
      const engine = { id: `database:${label.toLowerCase()}`, label, via: 'Drizzle' };
      for (const call of file.source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        if (call.getExpression().getText() !== local) continue;
        addEngine(builder, engine);
        builder.connect({
          from: file.nodeId,
          to: engine.id,
          kind: 'connects',
          location: at(file, call, 'use'),
        });
        const varDecl = call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
        if (varDecl) {
          clients.add(varDecl);
          engines.set(varDecl, engine);
        }
      }
    }
  }
  if (clients.size === 0) return;

  const engineFor = (node: Node): Engine | undefined => {
    const root = chainRoot(node);
    const decl = root ? declarationOf(root) : undefined;
    return decl ? engines.get(decl) : undefined;
  };

  for (const file of ctx.files.values()) {
    for (const call of file.source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      if (!callee.isKind(SyntaxKind.PropertyAccessExpression)) continue;
      const method = callee.getName();
      const receiver = callee.getExpression();
      const engine = engineFor(receiver);
      if (!engine) continue;

      if (
        (method === 'insert' || method === 'update' || method === 'delete') &&
        receiver.isKind(SyntaxKind.Identifier)
      ) {
        const table = drizzleTable(call.getArguments()[0]);
        if (table !== undefined) {
          connectTable(
            builder,
            file,
            engine,
            call,
            table,
            method === 'delete' ? 'deletes' : 'saves',
          );
        }
      } else if (method === 'from' && isSelectChain(receiver)) {
        const table = drizzleTable(call.getArguments()[0]);
        if (table !== undefined) connectTable(builder, file, engine, call, table, 'reads');
      } else if (
        /^find(Many|First)$/.test(method) &&
        receiver.isKind(SyntaxKind.PropertyAccessExpression)
      ) {
        const query = receiver.getExpression();
        if (query.isKind(SyntaxKind.PropertyAccessExpression) && query.getName() === 'query') {
          connectTable(builder, file, engine, call, receiver.getName(), 'reads');
        }
      }
    }
  }
}

function isSelectChain(node: Node): boolean {
  if (!node.isKind(SyntaxKind.CallExpression)) return false;
  const callee = node.getExpression();
  return (
    callee.isKind(SyntaxKind.PropertyAccessExpression) &&
    /^select(Distinct)?$/.test(callee.getName())
  );
}

/**
 * Supabase: when the project depends on a Supabase package, finds client
 * creation, and calls like `supabase.from('profiles').select()`.
 */
export function detectSupabase(ctx: AnalysisContext, builder: GraphBuilder): void {
  if (![...SUPABASE_PACKAGES].some((p) => ctx.dependencies.has(p))) return;
  const engine: Engine = { id: 'database:supabase', label: 'Supabase', via: 'Supabase client' };

  for (const file of ctx.files.values()) {
    const factories = new Set<string>();
    for (const decl of file.source.getImportDeclarations()) {
      if (!SUPABASE_PACKAGES.has(decl.getModuleSpecifierValue())) continue;
      for (const named of decl.getNamedImports()) {
        if (SUPABASE_CLIENT_FACTORIES.has(named.getName())) {
          factories.add((named.getAliasNode() ?? named.getNameNode()).getText());
        }
      }
    }

    for (const call of file.source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const calleeText = call.getExpression().getText();
      if (factories.has(calleeText)) {
        addEngine(builder, engine);
        builder.connect({
          from: file.nodeId,
          to: engine.id,
          kind: 'connects',
          location: at(file, call, 'use'),
        });
        continue;
      }
      const table = supabaseTable(call);
      if (table) connectTable(builder, file, engine, call, table.name, table.operation);
    }
  }
}

/** Matches `<client>.from('table').<operation>(...)`. */
function supabaseTable(call: CallExpression): { name: string; operation: DbOperation } | undefined {
  const callee = call.getExpression();
  if (!callee.isKind(SyntaxKind.PropertyAccessExpression)) return undefined;
  const operation = SUPABASE_OPERATIONS[callee.getName()];
  const fromCall = callee.getExpression();
  if (operation === undefined || !fromCall.isKind(SyntaxKind.CallExpression)) return undefined;
  const fromCallee = fromCall.getExpression();
  if (!fromCallee.isKind(SyntaxKind.PropertyAccessExpression) || fromCallee.getName() !== 'from') {
    return undefined;
  }
  const name = stringValue(fromCall.getArguments()[0]);
  return name === undefined ? undefined : { name, operation };
}
