import { constants } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';

/** Creates the folder if needed and writes the file without following a symlink at its path. */
export async function writeFileSafely(target: string, contents: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const handle = await open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    0o644,
  );
  try {
    await handle.writeFile(contents, 'utf8');
  } finally {
    await handle.close();
  }
}
