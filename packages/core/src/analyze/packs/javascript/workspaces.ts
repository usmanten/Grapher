/**
 * Workspace packages: the folders of a monorepo that each have their own
 * package.json, like `packages/core` named `@acme/core`. Code in one package
 * imports another by its name, as if it were downloaded from npm. Without
 * this, those imports would look like outside libraries instead of links to
 * the project's own files.
 */

/** A package.json found in the project. */
export interface WorkspacePackage {
  /** The `name` field, or `''` if it has none. */
  name: string;
  /** The package's folder, relative to the project root. `''` for the root itself. */
  dir: string;
  /** The parsed package.json. */
  manifest: Record<string, unknown>;
}

/** Folders that hold built output, and the source folder they are usually built from. */
const BUILD_DIR = /^(?:dist|build|lib|out|esm|cjs)\//;
const BUILT_EXTENSION = /\.(?:d\.[cm]?ts|[cm]?js)$/;
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
// Condition names in `exports`, in the order that best points at source code.
const CONDITIONS = ['source', 'development', 'types', 'import', 'module', 'default', 'require'];

const join = (dir: string, path: string) => {
  const clean = path.replace(/^\.\//, '');
  return dir === '' ? clean : `${dir}/${clean}`;
};

/** The first file path in an `exports` value, following conditions like `import` or `types`. */
function firstTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstTarget(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const condition of CONDITIONS) {
      const found = firstTarget(record[condition]);
      if (found !== undefined) return found;
    }
    for (const nested of Object.values(record)) {
      const found = firstTarget(nested);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/**
 * Where a package points for an import subpath (`.` for the package itself,
 * `./utils` for `pkg/utils`), as written in its package.json.
 */
function declaredTargets(pkg: WorkspacePackage, subpath: string): string[] {
  const targets: string[] = [];
  const exports = pkg.manifest.exports;
  if (typeof exports === 'string' || Array.isArray(exports)) {
    if (subpath === '.') {
      const found = firstTarget(exports);
      if (found !== undefined) targets.push(found);
    }
  } else if (exports && typeof exports === 'object') {
    const map = exports as Record<string, unknown>;
    const keys = Object.keys(map);
    // `{ "import": "./dist/index.js" }` is shorthand for the package's own entry.
    if (keys.every((k) => !k.startsWith('.'))) {
      if (subpath === '.') {
        const found = firstTarget(map);
        if (found !== undefined) targets.push(found);
      }
    } else {
      const exact = firstTarget(map[subpath]);
      if (exact !== undefined) targets.push(exact);
      for (const key of keys) {
        const star = key.indexOf('*');
        if (star === -1) continue;
        const before = key.slice(0, star);
        const after = key.slice(star + 1);
        if (!subpath.startsWith(before) || !subpath.endsWith(after)) continue;
        if (subpath.length < before.length + after.length) continue;
        const middle = subpath.slice(before.length, subpath.length - after.length);
        const found = firstTarget(map[key]);
        if (found !== undefined) targets.push(found.replaceAll('*', middle));
      }
    }
  }
  if (subpath === '.') {
    for (const field of ['source', 'types', 'typings', 'module', 'main']) {
      const value = pkg.manifest[field];
      if (typeof value === 'string') targets.push(value);
    }
  } else {
    // Without an `exports` entry, `pkg/utils` means the file at `utils`, or at `src/utils` in source.
    targets.push(subpath, `./src/${subpath.slice(2)}`);
  }
  return targets;
}

/**
 * Project files that a declared target could be. A package usually points at
 * its built output (`dist/index.js`), which Grapher skips, so the matching
 * source file (`src/index.ts`) is tried too.
 */
function candidates(path: string): string[] {
  const clean = path.replace(/^\.\//, '');
  const sourcePaths = [clean];
  if (BUILD_DIR.test(clean)) sourcePaths.push(clean.replace(BUILD_DIR, 'src/'));
  const result: string[] = [];
  for (const p of sourcePaths) {
    result.push(p);
    const stem = p.replace(BUILT_EXTENSION, '');
    for (const ext of SOURCE_EXTENSIONS) result.push(stem + ext);
    for (const ext of SOURCE_EXTENSIONS) result.push(`${stem}/index${ext}`);
  }
  return result;
}

const FALLBACK_ENTRIES = ['src/index', 'index'];

export interface Workspaces {
  /** The project file an import of another workspace package leads to. */
  resolve(specifier: string): string | undefined;
  /** Path mappings for the TypeScript compiler, so its own lookups find workspace files too. */
  compilerPaths(): Record<string, string[]>;
  /** Dependencies declared in any of the workspace's package.json files. */
  dependencies: Set<string>;
}

/**
 * Builds the lookup from a project's package.json files. `exists` tells
 * whether a path is one of the project files Grapher read.
 */
export function workspaces(
  packages: readonly WorkspacePackage[],
  exists: (path: string) => boolean,
): Workspaces {
  // The deepest folder wins when two package.json files share a name.
  const byName = new Map<string, WorkspacePackage>();
  for (const pkg of [...packages].sort((a, b) => a.dir.length - b.dir.length)) {
    if (pkg.name !== '') byName.set(pkg.name, pkg);
  }

  const dependencies = new Set<string>();
  for (const pkg of packages) {
    for (const field of [pkg.manifest.dependencies, pkg.manifest.devDependencies]) {
      if (field && typeof field === 'object') {
        for (const dep of Object.keys(field)) dependencies.add(dep);
      }
    }
  }

  function split(specifier: string): { pkg: WorkspacePackage; subpath: string } | undefined {
    const parts = specifier.split('/');
    const nameLength = specifier.startsWith('@') ? 2 : 1;
    const pkg = byName.get(parts.slice(0, nameLength).join('/'));
    if (!pkg) return undefined;
    const rest = parts.slice(nameLength).join('/');
    return { pkg, subpath: rest === '' ? '.' : `./${rest}` };
  }

  function resolve(specifier: string): string | undefined {
    const found = split(specifier);
    if (!found) return undefined;
    const { pkg, subpath } = found;
    const targets = declaredTargets(pkg, subpath);
    if (subpath === '.') targets.push(...FALLBACK_ENTRIES);
    for (const target of targets) {
      // A target that climbs out of the package folder isn't followed.
      if (target.split('/').includes('..')) continue;
      for (const candidate of candidates(target)) {
        const path = join(pkg.dir, candidate);
        if (exists(path)) return path;
      }
    }
    return undefined;
  }

  return {
    resolve,
    dependencies,
    compilerPaths() {
      const paths: Record<string, string[]> = {};
      for (const pkg of byName.values()) {
        const entry = resolve(pkg.name);
        if (entry !== undefined) paths[pkg.name] = [`/${entry}`];
      }
      return paths;
    },
  };
}
