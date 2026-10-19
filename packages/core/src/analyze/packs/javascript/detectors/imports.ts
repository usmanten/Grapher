import { SyntaxKind } from 'ts-morph';

import type { GraphBuilder } from '../../../builder.js';
import type { AnalysisContext, AnalyzedFile } from '../project.js';
import { at, isJsxTag, packageName, usesOf } from './shared.js';

/** A package import, handed to the package detectors. */
export interface PackageImport {
  file: AnalyzedFile;
  packageName: string;
  specifier: string;
  line: number;
  /** Local names bound by the import. */
  names: string[];
}

/**
 * Finds file-to-file connections from imports, and collects package imports
 * for the package detectors. Type-only imports are ignored: they vanish when
 * the code runs, so they aren't real connections.
 */
export function detectImports(ctx: AnalysisContext, builder: GraphBuilder): PackageImport[] {
  const packages: PackageImport[] = [];

  for (const file of ctx.files.values()) {
    for (const decl of file.source.getImportDeclarations()) {
      if (decl.isTypeOnly()) continue;
      const specifier = decl.getModuleSpecifierValue();
      const names = [
        decl.getDefaultImport()?.getText(),
        decl.getNamespaceImport()?.getText(),
        ...decl
          .getNamedImports()
          .filter((n) => !n.isTypeOnly())
          .map((n) => (n.getAliasNode() ?? n.getNameNode()).getText()),
      ].filter((n): n is string => n !== undefined);

      const target = decl.getModuleSpecifierSourceFile();
      // Files without imports or exports are scripts, which TypeScript won't resolve as modules.
      const targetFile =
        (target ? ctx.fileFor(target) : undefined) ?? resolveRelative(ctx, file, specifier);

      if (targetFile) {
        if (decl.getImportClause() === undefined) {
          // A side-effect import like `import './setup'` runs the file.
          builder.connect({
            from: file.nodeId,
            to: targetFile.nodeId,
            kind: 'uses',
            name: 'it',
            location: at(file, decl, 'import'),
          });
          continue;
        }
        if (names.length === 0) continue; // only type imports, like `import { type T }`
        let anyUse = false;
        for (const name of names) {
          const uses = usesOf(file.source, name);
          if (uses.length === 0) continue;
          anyUse = true;
          const displayed = uses.find(isJsxTag);
          builder.connect({
            from: file.nodeId,
            to: targetFile.nodeId,
            kind: displayed ? 'displays' : 'uses',
            name,
            location: at(file, decl, 'import'),
          });
          const firstUse = displayed ?? uses[0];
          if (firstUse) {
            builder.connect({
              from: file.nodeId,
              to: targetFile.nodeId,
              kind: displayed ? 'displays' : 'uses',
              location: at(file, firstUse, 'use'),
            });
          }
        }
        if (!anyUse) {
          builder.connect({
            from: file.nodeId,
            to: targetFile.nodeId,
            kind: 'uses',
            location: at(file, decl, 'import'),
          });
        }
        continue;
      }

      const pkg = packageName(specifier);
      if (pkg !== undefined) {
        packages.push({
          file,
          packageName: pkg,
          specifier,
          line: decl.getStartLineNumber(),
          names,
        });
      }
    }

    // `export { x } from './y'` and `export * from './y'` pass another file's code along.
    for (const decl of file.source.getExportDeclarations()) {
      if (decl.isTypeOnly()) continue;
      const target = decl.getModuleSpecifierSourceFile();
      const targetFile = target ? ctx.fileFor(target) : undefined;
      if (!targetFile) continue;
      builder.connect({
        from: file.nodeId,
        to: targetFile.nodeId,
        kind: 'uses',
        name: 're-exports',
        location: at(file, decl, 'import'),
      });
    }

    // `await import('./heavy')` loads a file only when needed.
    for (const call of file.source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
      const arg = call.getArguments()[0];
      if (!arg?.isKind(SyntaxKind.StringLiteral)) continue;
      const targetFile = resolveRelative(ctx, file, arg.getLiteralValue());
      if (!targetFile) continue;
      builder.connect({
        from: file.nodeId,
        to: targetFile.nodeId,
        kind: 'uses',
        name: 'it',
        location: at(file, call, 'use'),
      });
    }
  }
  return packages;
}

const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

/** Resolves a relative dynamic import to a project file. */
function resolveRelative(
  ctx: AnalysisContext,
  from: AnalyzedFile,
  specifier: string,
): AnalyzedFile | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const parts = from.path.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  const base = parts.join('/');
  for (const ext of EXTENSIONS) {
    const match = ctx.files.get(base + ext);
    if (match) return match;
  }
  return undefined;
}
