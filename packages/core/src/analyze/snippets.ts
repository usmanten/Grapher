import type { Graph } from '../graph/types.js';
import { scrub } from '../safety/detect.js';

/** Long lines are cut so a snippet stays a glance, not a copy of the file. */
export const MAX_SNIPPET_LENGTH = 160;

function snippetOf(line: string): string {
  const text = line.trim().replace(/\s+/g, ' ');
  // Scrub before cutting, so a key split by the cut can't slip through.
  const clean = scrub(text);
  return clean.length > MAX_SNIPPET_LENGTH ? `${clean.slice(0, MAX_SNIPPET_LENGTH - 1)}…` : clean;
}

/**
 * Adds the line of code behind each connection location, with anything
 * secret-looking replaced by `[hidden]`. Only one line is kept per location,
 * so as little code as possible leaves the parser.
 */
export function addSnippets(graph: Graph, texts: ReadonlyMap<string, string>): void {
  const lines = new Map<string, string[]>();
  for (const connection of graph.connections) {
    for (const location of connection.locations) {
      const text = texts.get(location.path);
      if (text === undefined) continue;
      let fileLines = lines.get(location.path);
      if (!fileLines) {
        fileLines = text.split(/\r?\n/);
        lines.set(location.path, fileLines);
      }
      const code = snippetOf(fileLines[location.line - 1] ?? '');
      if (code) location.code = code;
    }
  }
}
