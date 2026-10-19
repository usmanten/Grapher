import type { Node } from '@vscode/tree-sitter-wasm';

import {
  basename,
  type Candidate,
  dirname,
  type FileIndex,
  type ImportRef,
  joinPath,
} from './resolve.js';

/** What a language needs to know about the rest of the project to follow imports. */
export interface LinkContext {
  index: FileIndex;
  /** Go modules from go.mod files: the folder and the module path it declares. */
  goModules: { dir: string; module: string }[];
}

export interface BasicLanguage {
  /** A display name, like "Python". */
  name: string;
  /** The Tree-sitter grammar file, without `tree-sitter-` and `.wasm`. */
  grammar: string;
  extensions: string[];
  /** Test files check the code but aren't part of it, so they stay off the map. */
  isTest(path: string): boolean;
  /** The imports in a parsed file. */
  imports(root: Node, path: string, ctx: LinkContext): ImportRef[];
}

const line = (node: Node) => node.startPosition.row + 1;

const nodes = (list: (Node | null)[]): Node[] => list.filter((n): n is Node => n !== null);

/** `a.b.c` → `a/b/c` */
const dotted = (name: string) => name.split('.').join('/');

/** The text inside a string literal, without its quotes. */
function stringContent(node: Node | null): string | undefined {
  if (!node) return undefined;
  const content = node.descendantsOfType([
    'string_content',
    'interpreted_string_literal_content',
    'raw_string_literal_content',
  ])[0];
  if (content) return content.text;
  const quoted = /^["'](.+)["']$/.exec(node.text)?.[1];
  return quoted;
}

/**
 * Where a Python module might live: `a.b` may be a/b.py or the package
 * a/b/__init__.py, and `.models` is next to the importing file.
 */
export function pythonModuleCandidates(path: string, module: string): Candidate[] {
  const relative = /^(\.+)(.*)$/.exec(module);
  if (relative) {
    const ups = (relative[1] ?? '.').length - 1;
    const base = joinPath(
      dirname(path),
      ...Array<string>(ups).fill('..'),
      dotted(relative[2] ?? ''),
    );
    if (base === undefined) return [];
    const init = { path: base === '' ? '__init__.py' : `${base}/__init__.py` };
    // `from . import x` names the package itself, which only has an __init__.py.
    return relative[2] ? [{ path: `${base}.py` }, init] : [init];
  }
  return [{ suffix: `${dotted(module)}.py` }, { suffix: `${dotted(module)}/__init__.py` }];
}

export const python: BasicLanguage = {
  name: 'Python',
  grammar: 'python',
  extensions: ['.py'],
  isTest: (p) =>
    /(?:^|\/)(?:test_[^/]*|[^/]*_test|conftest)\.py$/.test(p) || /(?:^|\/)tests?\//.test(p),
  imports(root, path) {
    const refs: ImportRef[] = [];
    const moduleCandidates = (module: string) => pythonModuleCandidates(path, module);

    for (const stmt of root.descendantsOfType('import_statement')) {
      if (!stmt) continue;
      for (const nameNode of nodes(stmt.childrenForFieldName('name'))) {
        const module = (nameNode.childForFieldName('name') ?? nameNode).text;
        refs.push({ line: line(stmt), name: module, candidates: moduleCandidates(module) });
      }
    }
    for (const stmt of root.descendantsOfType('import_from_statement')) {
      const module = stmt?.childForFieldName('module_name')?.text;
      if (!stmt || module === undefined) continue;
      const names = nodes(stmt.childrenForFieldName('name')).map(
        (n) => (n.childForFieldName('name') ?? n).text,
      );
      if (names.length === 0) names.push('everything'); // `from x import *`
      for (const name of names) {
        // `from app import views` may import the module app/views.py rather than a name in app.
        const sub = module.endsWith('.') ? `${module}${name}` : `${module}.${name}`;
        refs.push({
          line: line(stmt),
          name,
          candidates: [...moduleCandidates(sub), ...moduleCandidates(module)],
        });
      }
    }
    return refs;
  },
};

const java: BasicLanguage = {
  name: 'Java',
  grammar: 'java',
  extensions: ['.java'],
  isTest: (p) => /(?:^|\/)src\/test\//.test(p) || /Tests?\.java$/.test(p),
  imports(root) {
    const refs: ImportRef[] = [];
    for (const decl of nodes(root.descendantsOfType('import_declaration'))) {
      const match = /^import\s+(static\s+)?([\w.]+?)(\.\*)?\s*;/.exec(decl.text);
      if (!match?.[2] || match[3]) continue; // `import a.b.*` names no single file
      let parts = match[2].split('.');
      if (match[1]) parts = parts.slice(0, -1); // a static import names a member of a class
      // Nested classes like `a.Outer.Inner` live in a/Outer.java.
      const candidates: Candidate[] = [];
      for (let end = parts.length; end >= 2; end--) {
        candidates.push({ suffix: `${parts.slice(0, end).join('/')}.java` });
      }
      refs.push({ line: line(decl), name: parts[parts.length - 1] ?? 'it', candidates });
    }
    return refs;
  },
};

const go: BasicLanguage = {
  name: 'Go',
  grammar: 'go',
  extensions: ['.go'],
  isTest: (p) => p.endsWith('_test.go'),
  imports(root, _path, ctx) {
    const refs: ImportRef[] = [];
    for (const spec of nodes(root.descendantsOfType('import_spec'))) {
      const importPath = stringContent(spec.childForFieldName('path'));
      if (importPath === undefined) continue;
      const candidates: Candidate[] = [];
      for (const { dir, module } of ctx.goModules) {
        if (importPath === module || importPath.startsWith(`${module}/`)) {
          const target = joinPath(dir, importPath.slice(module.length));
          if (target !== undefined) candidates.push({ dir: target });
        }
      }
      const alias = spec.childForFieldName('name')?.text;
      refs.push({ line: line(spec), name: alias ?? basename(importPath), candidates });
    }
    return refs;
  },
};

/** The folder a Rust file's child modules live in. */
function rustModuleDir(path: string): string {
  const stem = basename(path).replace(/\.rs$/, '');
  return ['mod', 'lib', 'main'].includes(stem)
    ? dirname(path)
    : (joinPath(dirname(path), stem) ?? '');
}

/** The folder of the crate root (lib.rs or main.rs) above a Rust file. */
function rustCrateDir(path: string, index: FileIndex): string | undefined {
  let dir = dirname(path);
  for (;;) {
    const prefix = dir === '' ? '' : `${dir}/`;
    if (index.has(`${prefix}lib.rs`) || index.has(`${prefix}main.rs`)) return dir;
    if (dir === '') return undefined;
    dir = dirname(dir);
  }
}

/** Candidates for a module path, longest first: `a::b::c` may be a/b/c.rs or an item in a/b.rs. */
function rustCandidates(base: string, segments: string[]): Candidate[] {
  const candidates: Candidate[] = [];
  for (let end = segments.length; end >= 1; end--) {
    const modulePath = joinPath(base, ...segments.slice(0, end));
    if (modulePath === undefined) continue;
    candidates.push({ path: `${modulePath}.rs` }, { path: `${modulePath}/mod.rs` });
  }
  return candidates;
}

const rust: BasicLanguage = {
  name: 'Rust',
  grammar: 'rust',
  extensions: ['.rs'],
  isTest: (p) => /(?:^|\/)tests\//.test(p),
  imports(root, path, ctx) {
    const refs: ImportRef[] = [];
    for (const item of nodes(root.descendantsOfType('mod_item'))) {
      const name = item.childForFieldName('name')?.text;
      if (name === undefined || item.childForFieldName('body')) continue; // inline `mod x { }`
      refs.push({
        line: line(item),
        name,
        candidates: rustCandidates(rustModuleDir(path), [name]),
      });
    }
    for (const decl of nodes(root.descendantsOfType('use_declaration'))) {
      const text = decl.childForFieldName('argument')?.text ?? '';
      const match = /^(crate|self|super)((?:::\w+)*)/.exec(text);
      if (!match) continue; // outside crates
      const segments = (match[2] ?? '').split('::').filter((s) => s !== '');
      let base: string | undefined;
      if (match[1] === 'crate') base = rustCrateDir(path, ctx.index);
      else if (match[1] === 'self') base = rustModuleDir(path);
      else base = dirname(rustModuleDir(path));
      if (base === undefined || segments.length === 0) continue;
      // `use crate::models::{User, Post}` takes several names from one module.
      const items = /\{([^}]*)\}/
        .exec(text)?.[1]
        ?.split(',')
        .map((item) => item.trim().split(/\s+as\s+/)[0] ?? '')
        .filter((item) => /^\w+$/.test(item));
      const names = items && items.length > 0 ? items : [segments[segments.length - 1] ?? 'it'];
      for (const name of names) {
        refs.push({ line: line(decl), name, candidates: rustCandidates(base, segments) });
      }
    }
    return refs;
  },
};

const cpp: BasicLanguage = {
  name: 'C and C++',
  grammar: 'cpp',
  extensions: ['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx'],
  isTest: (p) => /(?:^|\/)tests?\//.test(p),
  imports(root, path) {
    const refs: ImportRef[] = [];
    for (const include of nodes(root.descendantsOfType('preproc_include'))) {
      const pathNode = include.childForFieldName('path');
      if (pathNode?.type !== 'string_literal') continue; // `<stdio.h>` is a system header
      const target = stringContent(pathNode);
      if (target === undefined) continue;
      const relative = joinPath(dirname(path), target);
      refs.push({
        line: line(include),
        name: basename(target),
        candidates: [
          ...(relative === undefined ? [] : [{ path: relative }]),
          { suffix: joinPath(target) ?? target, anywhere: true },
        ],
      });
    }
    return refs;
  },
};

const ruby: BasicLanguage = {
  name: 'Ruby',
  grammar: 'ruby',
  extensions: ['.rb'],
  isTest: (p) => /_(?:spec|test)\.rb$/.test(p) || /(?:^|\/)(?:spec|test)\//.test(p),
  imports(root, path) {
    const refs: ImportRef[] = [];
    for (const call of nodes(root.descendantsOfType('call'))) {
      const method = call.childForFieldName('method')?.text;
      if (method !== 'require' && method !== 'require_relative' && method !== 'load') continue;
      const arg = call.childForFieldName('arguments')?.namedChildren[0] ?? null;
      const target = arg?.type === 'string' ? stringContent(arg) : undefined;
      if (target === undefined) continue;
      const file = target.endsWith('.rb') ? target : `${target}.rb`;
      const relative = method === 'require_relative' ? joinPath(dirname(path), file) : undefined;
      refs.push({
        line: line(call),
        name: basename(target).replace(/\.rb$/, ''),
        candidates:
          method === 'require_relative'
            ? relative === undefined
              ? []
              : [{ path: relative }]
            : [{ path: joinPath(dirname(path), file) ?? '' }, { suffix: file }],
      });
    }
    return refs;
  },
};

const PHP_INCLUDES = [
  'include_expression',
  'include_once_expression',
  'require_expression',
  'require_once_expression',
];

const php: BasicLanguage = {
  name: 'PHP',
  grammar: 'php',
  extensions: ['.php'],
  isTest: (p) => p.endsWith('Test.php') || /(?:^|\/)tests\//.test(p),
  imports(root, path) {
    const refs: ImportRef[] = [];
    for (const include of nodes(root.descendantsOfType(PHP_INCLUDES))) {
      // `require __DIR__ . '/config.php'` and `require 'config.php'` are both next to this file.
      const target = stringContent(
        include.descendantsOfType(['string', 'encapsed_string'])[0] ?? null,
      );
      if (target === undefined) continue;
      const relative = joinPath(dirname(path), target);
      if (relative === undefined) continue;
      refs.push({ line: line(include), name: 'it', candidates: [{ path: relative }] });
    }
    for (const decl of nodes(root.descendantsOfType('namespace_use_declaration'))) {
      const match = /^use\s+(?:function\s+|const\s+)?([\w\\]+?)\\?(?:\{([^}]*)\})?\s*;/.exec(
        decl.text,
      );
      if (!match?.[1]) continue;
      const items = match[2] === undefined ? [''] : match[2].split(',');
      for (const item of items) {
        const name = item.trim().split(/\s+as\s+/i)[0] ?? '';
        const full = [...match[1].split('\\'), ...name.split('\\')].filter((s) => s !== '');
        // Autoloaders map `App\Models\User` to a folder like app/Models/User.php, so the
        // first part of the namespace often doesn't match a folder name.
        refs.push({
          line: line(decl),
          name: full[full.length - 1] ?? 'it',
          candidates: [
            { suffix: `${full.join('/')}.php`, anywhere: true },
            { suffix: `${full.slice(1).join('/')}.php`, anywhere: true },
          ],
        });
      }
    }
    return refs;
  },
};

/** The languages the basic pack maps, without routes, databases or other special parts. */
export const BASIC_LANGUAGES: readonly BasicLanguage[] = [python, java, go, rust, cpp, ruby, php];

/** The basic language for a file, by its extension. */
export function languageFor(path: string): BasicLanguage | undefined {
  return BASIC_LANGUAGES.find((lang) => lang.extensions.some((ext) => path.endsWith(ext)));
}
