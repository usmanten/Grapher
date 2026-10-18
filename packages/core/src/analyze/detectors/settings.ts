import { SyntaxKind } from 'ts-morph';

import type { GraphBuilder } from '../builder.js';
import type { AnalysisContext, AnalyzedFile } from '../project.js';
import { at, stringValue } from './shared.js';

/** Set by Node.js or Next.js themselves, not by the developer. */
const BUILT_IN = new Set(['NODE_ENV', 'NEXT_RUNTIME', 'NEXT_PHASE']);
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function settingNodeId(name: string): string {
  return `setting:${name}`;
}

/** Records that a file reads a setting. Only the name is kept, never a value. */
export function connectSetting(
  builder: GraphBuilder,
  from: string,
  name: string,
  location: { path: string; line: number },
): void {
  if (BUILT_IN.has(name) || !VALID_NAME.test(name)) return;
  const id = settingNodeId(name);
  builder.addNode({ id, kind: 'setting', name, public: name.startsWith('NEXT_PUBLIC_') });
  builder.connect({ from, to: id, kind: 'reads-setting', location: { ...location, role: 'use' } });
}

function isProcessEnv(text: string): boolean {
  return text === 'process.env';
}

/**
 * Finds environment settings read with `process.env.NAME`,
 * `process.env['NAME']`, or `const { NAME } = process.env`.
 */
export function detectSettings(ctx: AnalysisContext, builder: GraphBuilder): void {
  for (const file of ctx.files.values()) {
    const record = (name: string, line: number) => {
      connectSetting(builder, file.nodeId, name, { path: file.path, line });
    };
    detectInFile(file, record);
  }
}

function detectInFile(file: AnalyzedFile, record: (name: string, line: number) => void): void {
  const source = file.source;
  for (const access of source.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (isProcessEnv(access.getExpression().getText())) {
      record(access.getName(), at(file, access, 'use').line);
    }
  }
  for (const access of source.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
    if (!isProcessEnv(access.getExpression().getText())) continue;
    const name = stringValue(access.getArgumentExpression());
    if (name !== undefined) record(name, access.getStartLineNumber());
  }
  for (const decl of source.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    const pattern = decl.getNameNode();
    if (
      !init ||
      !isProcessEnv(init.getText()) ||
      !pattern.isKind(SyntaxKind.ObjectBindingPattern)
    ) {
      continue;
    }
    for (const element of pattern.getElements()) {
      const name = (element.getPropertyNameNode() ?? element.getNameNode()).getText();
      record(name, element.getStartLineNumber());
    }
  }
}
