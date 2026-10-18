import path from 'node:path';

/** True when `target` is `root` itself or somewhere inside it. Both must be absolute. */
export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (relative === '') return true;
  const escapes = relative === '..' || relative.startsWith(`..${path.sep}`);
  return !escapes && !path.isAbsolute(relative);
}
