import ignore, { type Ignore } from 'ignore';

/** The rules from one .gitignore file, which apply to paths below `base`. */
export interface IgnoreLayer {
  /** Directory containing the .gitignore, relative to the root ('' for the root). */
  base: string;
  rules: Ignore;
}

export function parseGitignore(base: string, contents: string): IgnoreLayer {
  return { base, rules: ignore().add(contents) };
}

/**
 * Applies .gitignore layers the way git does: deeper files can override
 * shallower ones, and within a file the last matching rule wins.
 */
export function isGitignored(
  layers: readonly IgnoreLayer[],
  posixPath: string,
  isDirectory: boolean,
): boolean {
  let ignored = false;
  for (const layer of layers) {
    const relative = layer.base === '' ? posixPath : posixPath.slice(layer.base.length + 1);
    const result = layer.rules.test(isDirectory ? `${relative}/` : relative);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
}
