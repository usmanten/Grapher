import type { Graph } from '../graph/types.js';
import { scrub } from '../safety/detect.js';
import type { AnalyzedFile } from './project.js';

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
export function addSnippets(graph: Graph, files: ReadonlyMap<string, AnalyzedFile>): void {
  const lines = new Map<string, string[]>();
  for (const connection of graph.connections) {
    for (const location of connection.locations) {
      const file = files.get(location.path);
      if (!file) continue;
      let fileLines = lines.get(location.path);
      if (!fileLines) {
        fileLines = file.source.getFullText().split(/\r?\n/);
        lines.set(location.path, fileLines);
      }
      const code = snippetOf(fileLines[location.line - 1] ?? '');
      if (code) location.code = code;
    }
  }
}
