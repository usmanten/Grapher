import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import type * as TreeSitter from '@vscode/tree-sitter-wasm';

const require = createRequire(import.meta.url);

let runtime: Promise<typeof TreeSitter> | undefined;
const parsers = new Map<string, Promise<TreeSitter.Parser>>();

/** The folder holding the Tree-sitter runtime and grammar files, which ship with Grapher. */
function wasmDir(): string {
  return path.dirname(require.resolve('@vscode/tree-sitter-wasm'));
}

async function loadRuntime(): Promise<typeof TreeSitter> {
  const ts = require('@vscode/tree-sitter-wasm') as typeof TreeSitter;
  await ts.Parser.init({ locateFile: (file) => path.join(wasmDir(), file) });
  return ts;
}

/**
 * A shared parser for one Tree-sitter grammar. Grammars are loaded from local
 * files on first use, never from the network.
 */
export function parserFor(grammar: string): Promise<TreeSitter.Parser> {
  let parser = parsers.get(grammar);
  if (!parser) {
    parser = createParser(grammar);
    parsers.set(grammar, parser);
  }
  return parser;
}

async function createParser(grammar: string): Promise<TreeSitter.Parser> {
  runtime ??= loadRuntime();
  const ts = await runtime;
  // Reading the bytes ourselves keeps the loader on its local-file path, never its fetch path.
  const bytes = await readFile(path.join(wasmDir(), `tree-sitter-${grammar}.wasm`));
  const language = await ts.Language.load(new Uint8Array(bytes));
  const parser = new ts.Parser();
  parser.setLanguage(language);
  return parser;
}
