import type { Node } from '@vscode/tree-sitter-wasm';

import type { Findings, PyFile } from './project.js';
import {
  all,
  bodyStatements,
  calleeText,
  lineOf,
  positionalArgs,
  stringStart,
  stringValue,
  superclasses,
} from './syntax.js';

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Set by Python or Django themselves, not read as the developer's own settings. */
const BUILT_IN = new Set(['DJANGO_SETTINGS_MODULE', 'PYTHONPATH', 'HOME', 'PATH']);
/** Hosts that point back at the app itself during development. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

const ENV_GETTERS = new Set(['os.environ.get', 'environ.get', 'os.getenv', 'getenv']);
const HTTP_CLIENTS = /^(?:requests|httpx)\.(get|post|put|patch|delete|head|options|request)$/;

function connectSetting(findings: Findings, file: PyFile, name: string, node: Node): void {
  if (BUILT_IN.has(name) || !VALID_NAME.test(name)) return;
  const id = `setting:${name}`;
  findings.addNode({ id, kind: 'setting', name, public: false });
  findings.connect({
    from: file.nodeId,
    to: id,
    kind: 'reads-setting',
    location: { path: file.path, line: lineOf(node), role: 'use' },
  });
}

/** True if the file imports from a module, like `decouple` or `environ`. */
const importsModule = (file: PyFile, module: string) =>
  file.imports.some((imp) => imp.module === module || imp.module.startsWith(`${module}.`));

/**
 * Finds environment settings: `os.environ['NAME']`, `os.environ.get('NAME')`,
 * `os.getenv('NAME')`, python-decouple's `config('NAME')`, django-environ's
 * `env('NAME')`, and fields of a pydantic `BaseSettings` class. Only names
 * are recorded, never values.
 */
export function detectSettings(file: PyFile, findings: Findings): void {
  for (const subscript of all(file.root, 'subscript')) {
    const value = subscript.childForFieldName('value')?.text;
    if (value !== 'os.environ' && value !== 'environ') continue;
    const name = stringValue(subscript.childForFieldName('subscript'));
    if (name !== undefined) connectSetting(findings, file, name, subscript);
  }

  const decouple = importsModule(file, 'decouple');
  const djangoEnviron = importsModule(file, 'environ');
  for (const call of all(file.root, 'call')) {
    const callee = calleeText(call);
    const reads =
      ENV_GETTERS.has(callee) ||
      (decouple && callee === 'config') ||
      (djangoEnviron && /^env(?:\.\w+)?$/.test(callee));
    if (!reads) continue;
    const name = stringValue(positionalArgs(call)[0]);
    if (name !== undefined) connectSetting(findings, file, name, call);
  }

  // pydantic-settings fills each field of a BaseSettings class from the setting with its name.
  for (const cls of all(file.root, 'class_definition')) {
    if (
      !superclasses(cls).some((p) => p.text === 'BaseSettings' || p.text.endsWith('.BaseSettings'))
    ) {
      continue;
    }
    for (const statement of bodyStatements(cls)) {
      const assignment = statement.type === 'expression_statement' ? statement.namedChild(0) : null;
      const left = assignment?.type === 'assignment' ? assignment.childForFieldName('left') : null;
      if (!assignment?.childForFieldName('type') || left?.type !== 'identifier') continue;
      if (left.text === 'model_config') continue;
      connectSetting(findings, file, left.text.toUpperCase(), assignment);
    }
  }
}

/**
 * Finds calls to outside web services with requests or httpx, like
 * `requests.post('https://api.example.com/...')`. Only the host is recorded:
 * the rest of an address can carry keys.
 */
export function detectRequests(file: PyFile, findings: Findings): void {
  for (const call of all(file.root, 'call')) {
    const verb = HTTP_CLIENTS.exec(calleeText(call))?.[1];
    if (verb === undefined) continue;
    const args = positionalArgs(call);
    const urlNode = verb === 'request' ? args[1] : args[0];
    const url = stringValue(urlNode) ?? stringStart(urlNode) ?? '';
    // A login before `@` (like `https://token@host`) is skipped so it never becomes a label.
    const host = /^https?:\/\/(?:[^/?#@]*@)?([^/?#:@]+)/i.exec(url)?.[1]?.toLowerCase();
    if (host === undefined || LOCAL_HOSTS.has(host)) continue;
    const id = `service:${host}`;
    findings.addNode({ id, kind: 'service', label: host, source: host });
    findings.connect({
      from: file.nodeId,
      to: id,
      kind: 'uses-service',
      location: { path: file.path, line: lineOf(call), role: 'use' },
    });
  }
}
