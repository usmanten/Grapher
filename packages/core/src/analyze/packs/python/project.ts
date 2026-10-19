import type { Node } from '@vscode/tree-sitter-wasm';

import type { ConnectionInput, GraphBuilder } from '../../builder.js';
import type { GraphNode } from '../../../graph/types.js';
import { fileNodeId } from '../../pack.js';
import { pythonModuleCandidates } from '../basic/languages.js';
import type { FileIndex, ImportRef } from '../basic/resolve.js';
import { all, lineOf, present } from './syntax.js';

/** One name an import statement brings into a file. */
export interface PyImport {
  line: number;
  /** The module as written, like `app.models` or `.views`. */
  module: string;
  /** For `from module import name`: the name. Undefined for `import module`. */
  name?: string;
  /** The name the file uses for it, after any `as`. For `import a.b`, that's `a`. */
  local: string;
  /** True for `import a.b as x`, where `x` stands for the whole of `a.b`. */
  aliased: boolean;
}

export interface PyFile {
  path: string;
  nodeId: string;
  text: string;
  root: Node;
  imports: PyImport[];
  /** Imports in the form the basic pack's resolver understands, for file links. */
  refs: ImportRef[];
  /** Names defined in the file: functions, classes and assigned variables. */
  defined: Set<string>;
}

/** Where a name points: a project file, and the name inside it if it isn't the whole module. */
export interface Target {
  path: string;
  name?: string;
}

const isPython = (p: string) => p.endsWith('.py');

function importsOf(root: Node): PyImport[] {
  const found: PyImport[] = [];
  for (const stmt of all(root, 'import_statement')) {
    for (const nameNode of present(stmt.childrenForFieldName('name'))) {
      const aliased = nameNode.type === 'aliased_import';
      const module = (nameNode.childForFieldName('name') ?? nameNode).text;
      const local = aliased
        ? (nameNode.childForFieldName('alias')?.text ?? module)
        : (module.split('.')[0] ?? module);
      found.push({ line: lineOf(stmt), module, local, aliased });
    }
  }
  for (const stmt of all(root, 'import_from_statement')) {
    const module = stmt.childForFieldName('module_name')?.text;
    if (module === undefined) continue;
    for (const nameNode of present(stmt.childrenForFieldName('name'))) {
      const aliased = nameNode.type === 'aliased_import';
      const name = (nameNode.childForFieldName('name') ?? nameNode).text;
      const local = aliased ? (nameNode.childForFieldName('alias')?.text ?? name) : name;
      found.push({ line: lineOf(stmt), module, name, local, aliased });
    }
  }
  return found;
}

function definedNames(root: Node): Set<string> {
  const names = new Set<string>();
  for (const def of all(root, ['function_definition', 'class_definition'])) {
    const name = def.childForFieldName('name')?.text;
    if (name !== undefined) names.add(name);
  }
  for (const assignment of all(root, 'assignment')) {
    const left = assignment.childForFieldName('left');
    if (left?.type === 'identifier') names.add(left.text);
  }
  return names;
}

export function makeFile(path: string, text: string, root: Node, refs: ImportRef[]): PyFile {
  return {
    path,
    nodeId: fileNodeId(path),
    text,
    root,
    imports: importsOf(root),
    refs,
    defined: definedNames(root),
  };
}

/** `a.b` + `c` → `a.b.c`, and `.` + `views` → `.views`. */
const subModule = (module: string, name: string) =>
  module.endsWith('.') ? `${module}${name}` : `${module}.${name}`;

/** The Python files of a project, and how their names point at each other. */
export class PyProject {
  constructor(
    readonly files: ReadonlyMap<string, PyFile>,
    private readonly index: FileIndex,
  ) {}

  /** The project file a module name points to, seen from `from`. */
  resolveModule(from: string, module: string): string | undefined {
    return this.index.resolve(from, pythonModuleCandidates(from, module), isPython)[0];
  }

  /**
   * What a name written in a file points to, like `views.home` or `auth_bp`,
   * following the file's imports. Returns undefined for names from outside
   * the project.
   */
  resolveName(file: PyFile, expr: string): Target | undefined {
    const [first, ...rest] = expr.split('.');
    if (first === undefined || first === '') return undefined;
    const binding = file.imports.findLast((imp) => imp.local === first);
    if (!binding) {
      return rest.length === 0 && file.defined.has(first)
        ? { path: file.path, name: first }
        : undefined;
    }

    if (binding.name !== undefined) {
      // `from app import views` may bring in the module app/views.py, not a name in app.
      const asModule = this.walk(file, subModule(binding.module, binding.name), rest);
      if (asModule) return asModule;
      if (rest.length > 0) return undefined;
      const path = this.resolveModule(file.path, binding.module);
      return path === undefined ? undefined : { path, name: binding.name };
    }
    // `import a.b as x` makes `x` stand for a.b; plain `import a.b` binds `a`.
    return binding.aliased ? this.walk(file, binding.module, rest) : this.walk(file, first, rest);
  }

  /** Follows `base.rest...` as deep into submodules as the project goes, then takes the next part as a name. */
  private walk(file: PyFile, base: string, rest: string[]): Target | undefined {
    for (let depth = rest.length; depth >= 0; depth--) {
      const module = [base, ...rest.slice(0, depth)].reduce(subModule);
      const path = this.resolveModule(file.path, module);
      if (path === undefined) continue;
      const name = rest[depth];
      return name === undefined ? { path } : { path, name };
    }
    return undefined;
  }
}

/**
 * Collects what the detectors find while the syntax trees are open, so the
 * trees can be freed before the graph is built.
 */
export class Findings {
  private readonly nodes: GraphNode[] = [];
  private readonly connections: ConnectionInput[] = [];
  private readonly unknown: string[] = [];

  addNode(node: GraphNode): void {
    this.nodes.push(node);
  }

  connect(input: ConnectionInput): void {
    this.connections.push(input);
  }

  addUnknownPackage(name: string): void {
    this.unknown.push(name);
  }

  replay(builder: GraphBuilder): void {
    for (const node of this.nodes) builder.addNode(node);
    for (const name of this.unknown) builder.addUnknownPackage(name);
    for (const connection of this.connections) builder.connect(connection);
  }
}
