import { type Identifier, type Node, type SourceFile, SyntaxKind } from 'ts-morph';

import type { Location } from '../../../../graph/types.js';
import type { AnalyzedFile } from '../project.js';

/** npm package names: `name` or `@scope/name`. */
const VALID_PACKAGE = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;

export const at = (file: AnalyzedFile, node: Node, role: Location['role']): Location => ({
  path: file.path,
  line: node.getStartLineNumber(),
  role,
});

/** The package an import specifier belongs to: `@scope/pkg/sub` → `@scope/pkg`. */
export function packageName(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
    return undefined;
  }
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  // Path aliases like `@/lib/db` or `~/utils` that didn't resolve are not packages.
  return name !== undefined && VALID_PACKAGE.test(name) ? name : undefined;
}

/**
 * Identifiers in a file that refer to a name, outside import and export
 * statements. A name-based search is enough here: imported names are rarely
 * shadowed, and a missed use only weakens a label, never invents a connection.
 */
export function usesOf(source: SourceFile, name: string): Identifier[] {
  return source.getDescendantsOfKind(SyntaxKind.Identifier).filter((id) => {
    if (id.getText() !== name) return false;
    if (id.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)) return false;
    if (id.getFirstAncestorByKind(SyntaxKind.ExportDeclaration)) return false;
    // `obj.name` is a property, not a use of the imported `name`.
    const parent = id.getParent();
    if (parent.isKind(SyntaxKind.PropertyAccessExpression) && parent.getNameNode() === id) {
      return false;
    }
    if (parent.isKind(SyntaxKind.PropertyAssignment) && parent.getNameNode() === id) return false;
    return true;
  });
}

/** True if the identifier is the tag of a JSX element, like `<SignupForm />`. */
export function isJsxTag(id: Identifier): boolean {
  const parent = id.getParent();
  return (
    parent.isKind(SyntaxKind.JsxOpeningElement) || parent.isKind(SyntaxKind.JsxSelfClosingElement)
  );
}

/** Follows `a.b().c.d()` back to `a`, the identifier the chain starts from. */
export function chainRoot(node: Node): Identifier | undefined {
  let current: Node = node;
  for (;;) {
    if (current.isKind(SyntaxKind.Identifier)) return current;
    if (current.isKind(SyntaxKind.PropertyAccessExpression)) current = current.getExpression();
    else if (current.isKind(SyntaxKind.CallExpression)) current = current.getExpression();
    else if (current.isKind(SyntaxKind.AwaitExpression)) current = current.getExpression();
    else if (current.isKind(SyntaxKind.ParenthesizedExpression)) current = current.getExpression();
    else if (current.isKind(SyntaxKind.NonNullExpression)) current = current.getExpression();
    else return undefined;
  }
}

/** The declaration an identifier refers to, following imports to the original. */
export function declarationOf(id: Identifier): Node | undefined {
  let symbol = id.getSymbol();
  if (symbol?.isAlias()) symbol = symbol.getAliasedSymbol();
  return symbol?.getDeclarations()[0];
}

/** The string value of a literal argument, if it is one. */
export function stringValue(node: Node | undefined): string | undefined {
  if (
    node?.isKind(SyntaxKind.StringLiteral) ||
    node?.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)
  ) {
    return node.getLiteralValue();
  }
  return undefined;
}
