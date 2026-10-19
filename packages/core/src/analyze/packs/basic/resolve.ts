/**
 * Where an import might point, in order of preference. The first candidate
 * that matches a project file wins.
 */
export type Candidate =
  /** An exact path from the project root, like `app/models.py`. */
  | { path: string }
  /**
   * A path that may sit under a source folder, like `com/shop/Cart.java`
   * under `src/main/java/`. Only folders that contain the importing file
   * count as source folders, unless `anywhere` is set and exactly one file
   * matches.
   */
  | { suffix: string; anywhere?: boolean }
  /** Every file of the same language in a folder, like a Go package. */
  | { dir: string };

/** An import found in a file. */
export interface ImportRef {
  line: number;
  /** What the file takes from the target, like a class or function name. */
  name: string;
  candidates: Candidate[];
}

export const dirname = (filePath: string) => filePath.split('/').slice(0, -1).join('/');

export const basename = (filePath: string) => filePath.split('/').pop() ?? filePath;

/** Joins path pieces, resolving `.` and `..`. Returns undefined if it climbs above the root. */
export function joinPath(...pieces: string[]): string | undefined {
  const parts: string[] = [];
  for (const piece of pieces.join('/').split('/')) {
    if (piece === '' || piece === '.') continue;
    if (piece === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else {
      parts.push(piece);
    }
  }
  return parts.join('/');
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Looks up project files for import candidates. */
export class FileIndex {
  private readonly files: Set<string>;
  private readonly byDir = new Map<string, string[]>();
  private readonly byName = new Map<string, string[]>();

  constructor(paths: Iterable<string>) {
    this.files = new Set(paths);
    for (const filePath of this.files) {
      push(this.byDir, dirname(filePath), filePath);
      push(this.byName, basename(filePath), filePath);
    }
  }

  has(filePath: string): boolean {
    return this.files.has(filePath);
  }

  /** The project files an import points to, or none if it points outside the project. */
  resolve(from: string, candidates: readonly Candidate[], sameLanguage: (p: string) => boolean) {
    for (const candidate of candidates) {
      const found = this.match(from, candidate, sameLanguage);
      if (found.length > 0) return found.filter((p) => p !== from);
    }
    return [];
  }

  private match(from: string, candidate: Candidate, sameLanguage: (p: string) => boolean) {
    if ('path' in candidate) return this.files.has(candidate.path) ? [candidate.path] : [];
    if ('dir' in candidate) {
      return (this.byDir.get(candidate.dir) ?? []).filter(sameLanguage).sort();
    }
    const { suffix } = candidate;
    const matches = (this.byName.get(basename(suffix)) ?? []).filter(
      (p) => p === suffix || p.endsWith(`/${suffix}`),
    );
    // Prefer the closest source folder that contains the importing file.
    const fromDir = `${dirname(from)}/`;
    const inSourceFolder = matches
      .map((p) => ({ p, root: p.slice(0, p.length - suffix.length) }))
      .filter(({ root }) => root === '' || fromDir.startsWith(root))
      .sort((a, b) => b.root.length - a.root.length);
    const best = inSourceFolder[0];
    if (best) return [best.p];
    const only = matches[0];
    return candidate.anywhere === true && matches.length === 1 && only ? [only] : [];
  }
}
