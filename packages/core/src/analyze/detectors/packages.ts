import type { GraphBuilder } from '../builder.js';
import { isOrdinaryPackage, KNOWN_PACKAGES } from '../known-packages.js';
import { usesOf } from './shared.js';
import type { PackageImport } from './imports.js';

/**
 * Turns package imports into service and database connections using the
 * known-packages list. Anything unrecognized is recorded by name only, so it
 * can be classified later without sending any code.
 */
export function detectPackages(imports: readonly PackageImport[], builder: GraphBuilder): void {
  for (const imp of imports) {
    const known = KNOWN_PACKAGES.get(imp.packageName);
    if (!known) {
      // Config files import build tools like eslint or vitest, not parts of the app.
      if (imp.file.role !== 'config' && !isOrdinaryPackage(imp.packageName)) {
        builder.addUnknownPackage(imp.packageName);
      }
      continue;
    }

    const id = known.kind === 'service' ? `service:${imp.packageName}` : `database:${known.engine}`;
    if (known.kind === 'service') {
      builder.addNode({ id, kind: 'service', label: known.label, source: imp.packageName });
    } else {
      builder.addNode({
        id,
        kind: 'database',
        label: known.label,
        via: imp.packageName,
        inferred: true,
      });
    }

    const kind = known.kind === 'service' ? 'uses-service' : 'connects';
    const location = { path: imp.file.path, line: imp.line, role: 'import' as const };
    builder.connect({ from: imp.file.nodeId, to: id, kind, location });
    for (const name of imp.names) {
      const firstUse = usesOf(imp.file.source, name)[0];
      if (firstUse) {
        builder.connect({
          from: imp.file.nodeId,
          to: id,
          kind,
          location: { path: imp.file.path, line: firstUse.getStartLineNumber(), role: 'use' },
        });
      }
    }
  }
}
