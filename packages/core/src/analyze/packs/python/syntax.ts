import type { Node } from '@vscode/tree-sitter-wasm';

/** Helpers for reading Python syntax trees from Tree-sitter. */

export const lineOf = (node: Node) => node.startPosition.row + 1;

export const present = (list: (Node | null)[]): Node[] => list.filter((n): n is Node => n !== null);

/** All nodes of the given types under `root`. */
export function all(root: Node, types: string | string[]): Node[] {
  return present(root.descendantsOfType(types));
}

/**
 * The value of a plain string literal, like `'/users'`. Returns undefined for
 * f-strings with `{...}` parts and anything that isn't a string, since their
 * value is only known when the code runs.
 */
export function stringValue(node: Node | null | undefined): string | undefined {
  // `"SELECT ..." " FROM post"` is one string written in pieces.
  if (node?.type === 'concatenated_string') {
    const parts = present(node.namedChildren).map(stringValue);
    return parts.every((p) => p !== undefined) ? parts.join('') : undefined;
  }
  if (node?.type !== 'string') return undefined;
  let value = '';
  for (const child of node.namedChildren) {
    if (!child) continue;
    if (child.type === 'interpolation') return undefined;
    if (child.type === 'string_content' || child.type === 'escape_sequence') value += child.text;
  }
  return value;
}

/** The start of an f-string, up to its first `{...}` part, like `https://api.x.com/` in `f"https://api.x.com/{id}"`. */
export function stringStart(node: Node | null | undefined): string | undefined {
  if (node?.type !== 'string') return undefined;
  let value = '';
  for (const child of node.namedChildren) {
    if (!child) continue;
    if (child.type === 'interpolation') break;
    if (child.type === 'string_content') value += child.text;
  }
  return value;
}

/** The string values in a list or tuple literal, like `['GET', 'POST']`. */
export function stringList(node: Node | null | undefined): string[] {
  if (node?.type !== 'list' && node?.type !== 'tuple') return [];
  return present(node.namedChildren).flatMap((child) => {
    const value = stringValue(child);
    return value === undefined ? [] : [value];
  });
}

/** The arguments of a call without a name, in order. */
export function positionalArgs(call: Node): Node[] {
  const args = call.childForFieldName('arguments');
  if (args?.type !== 'argument_list') return [];
  return present(args.namedChildren).filter(
    (n) =>
      n.type !== 'keyword_argument' &&
      n.type !== 'comment' &&
      n.type !== 'list_splat' &&
      n.type !== 'dictionary_splat',
  );
}

/** The value of a named argument, like `methods` in `route('/', methods=['POST'])`. */
export function keywordArg(call: Node, name: string): Node | undefined {
  const args = call.childForFieldName('arguments');
  if (args?.type !== 'argument_list') return undefined;
  for (const child of present(args.namedChildren)) {
    if (child.type === 'keyword_argument' && child.childForFieldName('name')?.text === name) {
      return child.childForFieldName('value') ?? undefined;
    }
  }
  return undefined;
}

/** The text of what is being called, like `app.route` or `Flask`. */
export const calleeText = (call: Node) => call.childForFieldName('function')?.text ?? '';

/** The last part of a dotted name: `db.session.add` → `add`. */
export const lastPart = (dotted: string) => dotted.split('.').pop() ?? dotted;

/** The function or method a node sits in, if any. */
export function enclosingFunction(node: Node): Node | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'function_definition') return current;
  }
  return undefined;
}

/** True if the node is part of an import statement. */
export function inImport(node: Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'import_statement' || current.type === 'import_from_statement') {
      return true;
    }
  }
  return false;
}

/** `name = <call>` assignments: the name and the call. */
export function assignedCalls(root: Node): { name: string; call: Node }[] {
  const found: { name: string; call: Node }[] = [];
  for (const assignment of all(root, 'assignment')) {
    const left = assignment.childForFieldName('left');
    const right = assignment.childForFieldName('right');
    if (left?.type === 'identifier' && right?.type === 'call') {
      found.push({ name: left.text, call: right });
    }
  }
  return found;
}

/** The names of a class's parent classes, as written: `db.Model`, `Base`. */
export function superclasses(cls: Node): Node[] {
  const list = cls.childForFieldName('superclasses');
  return list ? present(list.namedChildren).filter((n) => n.type !== 'keyword_argument') : [];
}

/** The statements directly in a class or function body. */
export function bodyStatements(def: Node): Node[] {
  const body = def.childForFieldName('body');
  return body ? present(body.namedChildren) : [];
}

/** `name = value` statements directly in a class body, like `__tablename__ = 'users'`. */
export function classAssignments(cls: Node): { name: string; value: Node; node: Node }[] {
  const found: { name: string; value: Node; node: Node }[] = [];
  for (const statement of bodyStatements(cls)) {
    const assignment = statement.type === 'expression_statement' ? statement.namedChild(0) : null;
    if (assignment?.type !== 'assignment') continue;
    const left = assignment.childForFieldName('left');
    const right = assignment.childForFieldName('right');
    if (left?.type === 'identifier' && right) {
      found.push({ name: left.text, value: right, node: assignment });
    }
  }
  return found;
}
