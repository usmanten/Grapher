import type { Node } from '@vscode/tree-sitter-wasm';

import type { DbOperation } from '../../builder.js';
import { pluralize } from '../../labels.js';
import { KNOWN_PYTHON_PACKAGES } from './packages.js';
import type { Findings, PyFile, PyProject } from './project.js';
import {
  all,
  assignedCalls,
  bodyStatements,
  calleeText,
  classAssignments,
  enclosingFunction,
  lastPart,
  lineOf,
  positionalArgs,
  stringValue,
  superclasses,
} from './syntax.js';

type Orm = 'sqlalchemy' | 'django';

interface Model {
  name: string;
  table: string;
  orm: Orm;
  /** Abstract Django models and mixins hold fields for other models but have no table. */
  abstract: boolean;
}

interface Engine {
  id: string;
  label: string;
  via: string;
}

/** The start of a database address, like `postgresql+psycopg2://`. Only the scheme is ever kept. */
const URL_SCHEME =
  /^(postgres(?:ql)?|mysql|mariadb|sqlite|mssql|oracle|cockroachdb)(?:\+\w+)?:\/\//;

const SCHEME_LABELS: Record<string, string> = {
  postgres: 'Postgres',
  postgresql: 'Postgres',
  mysql: 'MySQL',
  mariadb: 'MySQL',
  sqlite: 'SQLite',
  mssql: 'SQL Server',
  oracle: 'Oracle',
  cockroachdb: 'CockroachDB',
};

const DJANGO_BACKENDS: Record<string, string> = {
  postgresql: 'Postgres',
  postgresql_psycopg2: 'Postgres',
  postgis: 'Postgres',
  mysql: 'MySQL',
  sqlite3: 'SQLite',
  spatialite: 'SQLite',
  oracle: 'Oracle',
};

/** Database drivers, by the name used to import or install them. */
const DRIVERS: Record<string, string> = {
  psycopg2: 'Postgres',
  'psycopg2-binary': 'Postgres',
  psycopg: 'Postgres',
  asyncpg: 'Postgres',
  pg8000: 'Postgres',
  pymysql: 'MySQL',
  MySQLdb: 'MySQL',
  mysqlclient: 'MySQL',
  aiomysql: 'MySQL',
  asyncmy: 'MySQL',
  aiosqlite: 'SQLite',
};

const DJANGO_READS = new Set(['objects']);
const DJANGO_SAVES = new Set([
  'create',
  'get_or_create',
  'update_or_create',
  'bulk_create',
  'bulk_update',
  'update',
]);
const SQLALCHEMY_BASES = new Set(['DeclarativeBase', 'DeclarativeBaseNoMeta']);
const SESSION_WRITES: Record<string, DbOperation> = {
  add: 'saves',
  add_all: 'saves',
  merge: 'saves',
  delete: 'deletes',
};
const STATEMENTS: Record<string, DbOperation> = {
  select: 'reads',
  select_from: 'reads',
  insert: 'saves',
  update: 'saves',
  delete: 'deletes',
};

/** `OrderItem` → `order_items`, the way beginners would name the table. */
function defaultTable(className: string): string {
  const snake = className
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
  return pluralize(snake);
}

/** `class Meta: db_table = 'x'` inside a Django model. */
function djangoMeta(cls: Node): { table?: string; abstract: boolean } {
  for (const statement of bodyStatements(cls)) {
    if (statement.type !== 'class_definition') continue;
    if (statement.childForFieldName('name')?.text !== 'Meta') continue;
    const assignments = classAssignments(statement);
    const table = stringValue(assignments.find((a) => a.name === 'db_table')?.value);
    const abstract = assignments.some((a) => a.name === 'abstract' && a.value.text === 'True');
    return table === undefined ? { abstract } : { table, abstract };
  }
  return { abstract: false };
}

/** Finds model classes: each one is a table in the database. */
function findModels(project: PyProject): Map<string, Model> {
  const sqlalchemyInstances = new Set<string>();
  const bases = new Map<string, Orm>();
  for (const file of project.files.values()) {
    for (const { name, call } of assignedCalls(file.root)) {
      const fn = lastPart(calleeText(call));
      if (fn === 'SQLAlchemy') sqlalchemyInstances.add(name);
      if (fn === 'declarative_base' || fn === 'generate_base') bases.set(name, 'sqlalchemy');
    }
  }

  const classes = [...project.files.values()].flatMap((file) =>
    all(file.root, 'class_definition').map((cls) => ({ file, cls })),
  );
  const pending = [...classes];
  const models = new Map<string, Model>();
  // Models can build on other models, so keep going until nothing new turns up.
  for (let changed = true; changed;) {
    changed = false;
    for (const [i, { file, cls }] of pending.entries()) {
      const name = cls.childForFieldName('name')?.text;
      if (name === undefined) continue;
      const orm = ormOf(file, cls, sqlalchemyInstances, bases, models);
      if (orm === undefined) continue;
      pending.splice(i, 1);
      changed = true;
      if (orm === 'base') {
        bases.set(name, 'sqlalchemy');
        break;
      }
      const assignments = classAssignments(cls);
      const meta = orm === 'django' ? djangoMeta(cls) : { abstract: false };
      const table =
        stringValue(assignments.find((a) => a.name === '__tablename__')?.value) ??
        ('table' in meta ? meta.table : undefined) ??
        defaultTable(name);
      const abstract =
        meta.abstract ||
        assignments.some((a) => a.name === '__abstract__' && a.value.text === 'True');
      if (!models.has(name)) models.set(name, { name, table, orm, abstract });
      break;
    }
  }
  return models;
}

function ormOf(
  file: PyFile,
  cls: Node,
  sqlalchemyInstances: Set<string>,
  bases: Map<string, Orm>,
  models: Map<string, Model>,
): Orm | 'base' | undefined {
  // SQLModel: only `class Hero(HeroBase, table=True)` is a table; other SQLModel classes are data shapes.
  if (/\btable\s*=\s*True\b/.test(cls.childForFieldName('superclasses')?.text ?? '')) {
    return 'sqlalchemy';
  }
  const parents = superclasses(cls);
  for (const parent of parents) {
    const text = parent.text;
    if (SQLALCHEMY_BASES.has(lastPart(text))) return 'base';
    if (text === 'SQLModel') return undefined;
    const [owner, member] = text.split('.');
    if (member === 'Model' && owner !== undefined && sqlalchemyInstances.has(owner)) {
      return 'sqlalchemy';
    }
    if (text === 'models.Model' || (text === 'Model' && importsFrom(file, 'Model', 'django.db'))) {
      return 'django';
    }
    const base = bases.get(lastPart(text));
    if (base) return base;
    const model = models.get(lastPart(text));
    if (model) return model.orm;
  }
  return undefined;
}

function importsFrom(file: PyFile, local: string, modulePrefix: string): boolean {
  return file.imports.some((imp) => imp.local === local && imp.module.startsWith(modulePrefix));
}

/** The model a name in a file refers to: `User`, or `models.User` through a module import. */
function modelFor(file: PyFile, expr: string, models: Map<string, Model>): Model | undefined {
  const parts = expr.split('.');
  if (parts.length === 1) {
    const binding = file.imports.findLast((imp) => imp.local === expr);
    const name = binding?.name ?? (file.defined.has(expr) ? expr : undefined);
    const model = name === undefined ? undefined : models.get(name);
    return model?.abstract === false ? model : undefined;
  }
  if (parts.length === 2 && file.imports.some((imp) => imp.local === parts[0])) {
    const model = models.get(parts[1] ?? '');
    return model?.abstract === false ? model : undefined;
  }
  return undefined;
}

/** The method names called along a chain like `User.query.filter_by(x).delete()`. */
function chainMethods(start: Node): string[] {
  const names: string[] = [];
  let current: Node = start;
  for (let parent = current.parent; parent; parent = current.parent) {
    if (parent.type === 'attribute' && parent.childForFieldName('object')?.id === current.id) {
      names.push(parent.childForFieldName('attribute')?.text ?? '');
    } else if (!(
      parent.type === 'call' && parent.childForFieldName('function')?.id === current.id
    )) {
      break;
    }
    current = parent;
  }
  return names;
}

/**
 * The tables a function works with when the code saves or deletes an object
 * without naming its model on that line: models it creates, or else the one
 * model it mentions.
 */
function tablesInFunction(file: PyFile, node: Node, models: Map<string, Model>): Model[] {
  const fn = enclosingFunction(node);
  if (!fn) return [];
  const created = new Set<Model>();
  for (const call of all(fn, 'call')) {
    const model = modelFor(file, calleeText(call), models);
    if (model) created.add(model);
  }
  if (created.size > 0) return [...created];
  const mentioned = new Set<Model>();
  for (const id of all(fn, ['identifier', 'attribute'])) {
    const model = modelFor(file, id.text, models);
    if (model) mentioned.add(model);
  }
  return mentioned.size === 1 ? [...mentioned] : [];
}

function hasModelArg(file: PyFile, call: Node, models: Map<string, Model>): Model | undefined {
  for (const arg of positionalArgs(call)) {
    const model = modelFor(file, arg.text, models);
    if (model) return model;
  }
  return undefined;
}

interface Use {
  node: Node;
  model?: Model;
  orm: Orm;
  operation: DbOperation;
}

function sqlalchemyUses(file: PyFile, models: Map<string, Model>): Use[] {
  const uses: Use[] = [];
  const orm = 'sqlalchemy';
  const sqlalchemy = (model: Model | undefined): model is Model => model?.orm === orm;

  // `User.query.filter_by(...).first()`
  for (const attr of all(file.root, 'attribute')) {
    if (attr.childForFieldName('attribute')?.text !== 'query') continue;
    const model = modelFor(file, attr.childForFieldName('object')?.text ?? '', models);
    if (!sqlalchemy(model)) continue;
    const chain = chainMethods(attr);
    const operation = chain.includes('delete')
      ? 'deletes'
      : chain.includes('update')
        ? 'saves'
        : 'reads';
    uses.push({ node: attr, model, orm, operation });
  }

  for (const call of all(file.root, 'call')) {
    const callee = calleeText(call);
    const method = lastPart(callee);
    const owner = callee.slice(0, -method.length - 1);
    const model = hasModelArg(file, call, models);
    if (sqlalchemy(model) && (method === 'query' || method === 'get_or_404')) {
      uses.push({ node: call, model, orm, operation: 'reads' });
    } else if (sqlalchemy(model) && method === 'get' && owner.includes('session')) {
      uses.push({ node: call, model, orm, operation: 'reads' });
    } else if (sqlalchemy(model) && STATEMENTS[method] && !owner.includes('session')) {
      uses.push({ node: call, model, orm, operation: STATEMENTS[method] });
    } else if (owner.endsWith('session') && SESSION_WRITES[method]) {
      const operation = SESSION_WRITES[method];
      const tables = tablesInFunction(file, call, models).filter((m) => m.orm === orm);
      if (tables.length === 0) uses.push({ node: call, orm, operation });
      for (const table of tables) uses.push({ node: call, model: table, orm, operation });
    }
  }
  return uses;
}

function djangoUses(file: PyFile, models: Map<string, Model>): Use[] {
  const uses: Use[] = [];
  const orm = 'django';
  const django = (model: Model | undefined): model is Model => model?.orm === orm;

  // `Article.objects.filter(...)`, `Article.objects.create(...)`
  for (const attr of all(file.root, 'attribute')) {
    if (!DJANGO_READS.has(attr.childForFieldName('attribute')?.text ?? '')) continue;
    const model = modelFor(file, attr.childForFieldName('object')?.text ?? '', models);
    if (!django(model)) continue;
    const chain = chainMethods(attr);
    const operation = chain.includes('delete')
      ? 'deletes'
      : chain.some((m) => DJANGO_SAVES.has(m))
        ? 'saves'
        : 'reads';
    uses.push({ node: attr, model, orm, operation });
  }

  for (const call of all(file.root, 'call')) {
    const callee = calleeText(call);
    const method = lastPart(callee);
    if (method === 'get_object_or_404' || method === 'get_list_or_404') {
      const model = modelFor(file, positionalArgs(call)[0]?.text ?? '', models);
      if (django(model)) uses.push({ node: call, model, orm, operation: 'reads' });
    } else if (
      (method === 'save' || method === 'delete') &&
      positionalArgs(call).length === 0 &&
      callee.split('.').length === 2 &&
      !callee.includes('objects')
    ) {
      // `article.save()`: only counted when the function shows which model it is.
      const operation = method === 'save' ? 'saves' : 'deletes';
      for (const model of tablesInFunction(file, call, models).filter(django)) {
        uses.push({ node: call, model, orm, operation });
      }
    }
  }

  // Class-based views: `model = Article` in the class body.
  for (const cls of all(file.root, 'class_definition')) {
    for (const { name, value, node } of classAssignments(cls)) {
      if (name !== 'model') continue;
      const model = modelFor(file, value.text, models);
      if (django(model)) uses.push({ node, model, orm, operation: 'reads' });
    }
  }
  return uses;
}

function labelFor(project: PyProject, orm: Orm, dependencies: string): string {
  for (const file of [...project.files.values()]) {
    for (const node of all(file.root, 'string')) {
      const value = stringValue(node);
      if (value === undefined) continue;
      if (orm === 'django') {
        const backend = /^django\.(?:contrib\.gis\.)?db\.backends\.(\w+)$/.exec(value)?.[1];
        if (backend !== undefined && DJANGO_BACKENDS[backend]) return DJANGO_BACKENDS[backend];
      }
      const scheme = URL_SCHEME.exec(value)?.[1];
      if (scheme !== undefined && SCHEME_LABELS[scheme]) return SCHEME_LABELS[scheme];
    }
  }
  const imported = [...project.files.values()].flatMap((f) =>
    f.imports.map((i) => i.module.split('.')[0] ?? ''),
  );
  for (const [driver, label] of Object.entries(DRIVERS)) {
    if (
      imported.includes(driver) ||
      new RegExp(`(?:^|[\\s"'\\[])${driver}\\b`, 'im').test(dependencies)
    ) {
      return label;
    }
  }
  return 'Database';
}

/** Files that open the connection: `create_engine(...)`, `SQLAlchemy(app)`, or Django's `DATABASES` setting. */
function connections(project: PyProject, orm: Orm): { file: PyFile; node: Node }[] {
  const found: { file: PyFile; node: Node }[] = [];
  for (const file of project.files.values()) {
    if (orm === 'sqlalchemy') {
      for (const call of all(file.root, 'call')) {
        const fn = lastPart(calleeText(call));
        if (fn === 'create_engine' || fn === 'create_async_engine' || fn === 'SQLAlchemy') {
          found.push({ file, node: call });
        }
      }
    } else {
      for (const assignment of all(file.root, 'assignment')) {
        if (assignment.childForFieldName('left')?.text === 'DATABASES') {
          found.push({ file, node: assignment });
        }
      }
    }
  }
  return found;
}

function viaFor(project: PyProject, orm: Orm): string {
  if (orm === 'django') return 'Django ORM';
  const imported = new Set(
    [...project.files.values()].flatMap((f) => f.imports.map((i) => i.module.split('.')[0] ?? '')),
  );
  if (imported.has('sqlmodel')) return 'SQLModel';
  if (imported.has('flask_sqlalchemy')) return 'Flask-SQLAlchemy';
  return 'SQLAlchemy';
}

/**
 * SQLAlchemy (including Flask-SQLAlchemy and SQLModel) and the Django ORM:
 * finds the model classes, then the places that read, save or delete them,
 * and the file that opens the connection.
 */
export function detectDatabases(
  project: PyProject,
  findings: Findings,
  dependencies: string,
): Orm[] {
  const models = findModels(project);
  const engines = new Map<Orm, Engine>();
  const engineFor = (orm: Orm): Engine => {
    let engine = engines.get(orm);
    if (!engine) {
      const label = labelFor(project, orm, dependencies);
      engine = {
        id: `database:${label.toLowerCase().replace(/\s+/g, '-')}`,
        label,
        via: viaFor(project, orm),
      };
      engines.set(orm, engine);
      findings.addNode({ id: engine.id, kind: 'database', label: engine.label, via: engine.via });
    }
    return engine;
  };

  const orms = new Set<Orm>([...models.values()].map((m) => m.orm));
  for (const orm of ['sqlalchemy', 'django'] as const) {
    const opened = connections(project, orm);
    if (opened.length > 0) orms.add(orm);
    if (!orms.has(orm)) continue;
    for (const { file, node } of opened) {
      findings.connect({
        from: file.nodeId,
        to: engineFor(orm).id,
        kind: 'connects',
        location: { path: file.path, line: lineOf(node), role: 'use' },
      });
    }
  }

  for (const file of project.files.values()) {
    const uses = [
      ...(orms.has('sqlalchemy') ? sqlalchemyUses(file, models) : []),
      ...(orms.has('django') ? djangoUses(file, models) : []),
    ];
    for (const use of uses) {
      findings.connect({
        from: file.nodeId,
        to: engineFor(use.orm).id,
        kind: use.operation === 'reads' ? 'reads' : 'writes',
        operation: use.operation,
        ...(use.model ? { detail: use.model.table } : {}),
        location: { path: file.path, line: lineOf(use.node), role: 'use' },
      });
    }
  }
  const raw = rawEngine(
    project,
    orms.has('sqlalchemy') ? () => engineFor('sqlalchemy') : undefined,
  );
  if (raw) {
    for (const file of project.files.values()) {
      for (const use of rawSqlUses(file)) {
        findings.connect({
          from: file.nodeId,
          to: raw(findings).id,
          kind: use.operation === 'reads' ? 'reads' : 'writes',
          operation: use.operation,
          detail: use.table,
          location: { path: file.path, line: lineOf(use.node), role: 'use' },
        });
      }
    }
  }
  return [...orms];
}

const SQL_RUNNERS = new Set([
  'execute',
  'executemany',
  'fetch',
  'fetchrow',
  'fetchval',
  'fetchall',
]);
const SQL_TABLE = '[`"\\[]?(\\w+)[`"\\]]?';

/** The tables a line of SQL works with, like `SELECT * FROM post JOIN user`. */
export function sqlTables(sql: string): { table: string; operation: DbOperation }[] {
  const text = sql.trim().replace(/\s+/g, ' ');
  const verb = /^(\w+)/.exec(text)?.[1]?.toUpperCase();
  const find = (pattern: string, operation: DbOperation) =>
    [...text.matchAll(new RegExp(pattern, 'gi'))].flatMap((m) =>
      m[1] === undefined ? [] : [{ table: m[1], operation }],
    );
  switch (verb) {
    case 'SELECT':
    case 'WITH':
      return find(`\\b(?:FROM|JOIN) ${SQL_TABLE}`, 'reads');
    case 'INSERT':
    case 'REPLACE':
      return find(`^\\w+ (?:OR \\w+ )?INTO ${SQL_TABLE}`, 'saves');
    case 'UPDATE':
      return find(`^UPDATE ${SQL_TABLE}`, 'saves');
    case 'DELETE':
      return find(`^DELETE FROM ${SQL_TABLE}`, 'deletes');
    default:
      return [];
  }
}

/** SQL written by hand, like `db.execute('SELECT * FROM post')` with sqlite3 or psycopg. */
function rawSqlUses(file: PyFile): { node: Node; table: string; operation: DbOperation }[] {
  const uses: { node: Node; table: string; operation: DbOperation }[] = [];
  for (const call of all(file.root, 'call')) {
    if (!SQL_RUNNERS.has(lastPart(calleeText(call)))) continue;
    let arg = positionalArgs(call)[0];
    // SQLAlchemy wraps hand-written SQL in text('...').
    if (arg?.type === 'call' && lastPart(calleeText(arg)) === 'text') arg = positionalArgs(arg)[0];
    const sql = stringValue(arg);
    if (sql === undefined) continue;
    for (const { table, operation } of sqlTables(sql)) uses.push({ node: call, table, operation });
  }
  return uses;
}

/**
 * The database hand-written SQL goes to: the one database driver the project
 * imports (like sqlite3 or psycopg2), or else SQLAlchemy's database.
 */
function rawEngine(
  project: PyProject,
  sqlalchemy: (() => Engine) | undefined,
): ((findings: Findings) => Engine) | undefined {
  const drivers = new Map<string, Engine>();
  for (const file of project.files.values()) {
    for (const imp of file.imports) {
      const known = KNOWN_PYTHON_PACKAGES.get(imp.module);
      if (known?.kind !== 'database' || !SQL_DRIVERS.has(imp.module)) continue;
      drivers.set(known.engine, {
        id: `database:${known.engine}`,
        label: known.label,
        via: imp.module,
      });
    }
  }
  const only = drivers.size === 1 ? [...drivers.values()][0] : undefined;
  if (only) {
    return (findings) => {
      findings.addNode({
        id: only.id,
        kind: 'database',
        label: only.label,
        via: only.via,
        inferred: true,
      });
      return only;
    };
  }
  return sqlalchemy ? () => sqlalchemy() : undefined;
}

/** Drivers that run SQL, from the known packages list. */
const SQL_DRIVERS = new Set([
  'sqlite3',
  'aiosqlite',
  'psycopg2',
  'psycopg',
  'asyncpg',
  'pymysql',
  'MySQLdb',
  'mysql.connector',
]);
