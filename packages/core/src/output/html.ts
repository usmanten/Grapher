import type { Graph } from '../graph/types.js';
import { assertNoSecrets } from '../safety/check.js';

/** Everything the viewer page needs, embedded into it as JSON. */
export interface ViewerData {
  graph: Graph;
  /** Absolute project folder, used only to build "open in VS Code" links. */
  root: string;
  /** Secret files Grapher skipped, by path only, so the viewer can show they were never read. */
  protectedFiles: string[];
}

export const VIEWER_DATA_PLACEHOLDER = '"__GRAPHER_DATA__"';

/**
 * JSON that is safe to place inside a `<script>` element. Escaping `<`, `>`
 * and `&` means a value like `</script>` in a file name can't end the element
 * early and inject HTML. U+2028 and U+2029 are escaped for older parsers.
 */
export function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029');
}

/** Fills the viewer template with the project's data. */
export function renderViewer(template: string, data: ViewerData): string {
  assertNoSecrets(data);
  const at = template.indexOf(VIEWER_DATA_PLACEHOLDER);
  if (at === -1 || template.includes(VIEWER_DATA_PLACEHOLDER, at + 1)) {
    throw new Error('The viewer template must contain the data placeholder exactly once');
  }
  return (
    template.slice(0, at) +
    scriptSafeJson(data) +
    template.slice(at + VIEWER_DATA_PLACEHOLDER.length)
  );
}
