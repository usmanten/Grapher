import type { GraphNode } from '../../../../graph/types.js';
import type { GraphBuilder } from '../../../builder.js';
import {
  type IdentifiedPackages,
  isOrdinaryPackage,
  KNOWN_PACKAGES,
} from '../../../known-packages.js';
import { usesOf } from './shared.js';
import type { PackageImport } from './imports.js';

/**
 * The box a package import points to: from the known-packages list, from
 * what Claude identified by name, or a gray "not yet identified" box. Returns
 * undefined for ordinary libraries, which stay off the map.
 */
function packageNode(
  imp: PackageImport,
  identified: IdentifiedPackages,
  builder: GraphBuilder,
): GraphNode | undefined {
  const name = imp.packageName;
  const known = KNOWN_PACKAGES.get(name);
  if (known?.kind === 'service') {
    return { id: `service:${name}`, kind: 'service', label: known.label, source: name };
  }
  if (known?.kind === 'database') {
    return {
      id: `database:${known.engine}`,
      kind: 'database',
      label: known.label,
      via: name,
      inferred: true,
    };
  }
  // Config files import build tools like eslint or vitest, not parts of the app.
  if (isOrdinaryPackage(name) || imp.file.role === 'config') return undefined;

  const ai = identified.get(name);
  if (ai?.kind === 'library') return undefined;
  if (ai?.kind === 'service') {
    return {
      id: `service:${name}`,
      kind: 'service',
      label: ai.label,
      source: name,
      identifiedBy: 'ai',
    };
  }
  if (ai?.kind === 'database') {
    return {
      id: `database:${name}`,
      kind: 'database',
      label: ai.label,
      via: name,
      inferred: true,
      identifiedBy: 'ai',
    };
  }
  builder.addUnknownPackage(name);
  return { id: `service:${name}`, kind: 'service', label: name, source: name, unidentified: true };
}

/**
 * Turns package imports into service and database connections. Packages
 * Grapher doesn't know are recorded by name only, so Claude can identify
 * them later without seeing any code; until then they show as gray boxes.
 */
export function detectPackages(
  imports: readonly PackageImport[],
  builder: GraphBuilder,
  identified: IdentifiedPackages = new Map(),
): void {
  for (const imp of imports) {
    const node = packageNode(imp, identified, builder);
    if (!node) continue;
    builder.addNode(node);

    const kind = node.kind === 'database' ? 'connects' : 'uses-service';
    const location = { path: imp.file.path, line: imp.line, role: 'import' as const };
    builder.connect({ from: imp.file.nodeId, to: node.id, kind, location });
    for (const name of imp.names) {
      const firstUse = usesOf(imp.file.source, name)[0];
      if (firstUse) {
        builder.connect({
          from: imp.file.nodeId,
          to: node.id,
          kind,
          location: { path: imp.file.path, line: firstUse.getStartLineNumber(), role: 'use' },
        });
      }
    }
  }
}
