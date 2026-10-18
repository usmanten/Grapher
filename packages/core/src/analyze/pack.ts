import type { FileNode, Graph, GraphWarning } from '../graph/types.js';
import type { SourceReader } from '../scan/reader.js';
import type { ScanResult } from '../scan/types.js';
import type { GraphBuilder } from './builder.js';
import type { IdentifiedPackages } from './known-packages.js';

/**
 * A language pack teaches Grapher one language and its frameworks. Every
 * pack answers the same three questions:
 *
 * 1. Which files are mine? (`claims`, then `load`)
 * 2. Which file uses which? (`linkFiles`)
 * 3. What are the special parts, like web routes, databases, outside
 *    services and settings? (`findSpecialParts`)
 *
 * Everything after that (the graph, labels, explanations, secret checks and
 * the viewer) is shared, so it never needs to know what language a file is
 * written in. To add a language, write a pack and add it to `DEFAULT_PACKS`.
 */
export interface LanguagePack {
  /** A short, stable id, like `javascript`. */
  readonly id: string;
  /** A display name, like "JavaScript and TypeScript". */
  readonly name: string;
  /**
   * True if this pack reads the file at `path`. When several packs claim the
   * same file, the one listed first gets it.
   */
  claims(path: string): boolean;
  /**
   * Reads and parses the claimed files. Every read must go through
   * `input.reader`, which refuses secret files and paths outside the project.
   */
  load(input: PackInput): Promise<LoadedPack>;
}

export interface PackInput {
  /** The whole scan, for project files like package.json or go.mod. */
  scan: ScanResult;
  reader: SourceReader;
  /** The files this pack claimed, sorted by path. */
  paths: string[];
  /** Packages Claude identified by name in an earlier run. */
  identified?: IdentifiedPackages;
}

/** A file a pack read, ready to go on the map. */
export interface PackFile {
  node: FileNode;
  /** The file's text, used to show the line of code behind each connection. */
  text: string;
}

/** A pack after it has read its files. */
export interface LoadedPack {
  files: PackFile[];
  /** Files that could not be read or parsed, with a reason. */
  problems: { path: string; message: string }[];
  /** Notes for the user, like an unsupported folder layout. */
  warnings: GraphWarning[];
  /** The framework this pack recognized, if any. */
  framework?: Exclude<Graph['project']['framework'], 'unknown'>;
  /** The project's name, if the pack found one (like `name` in package.json). */
  projectName?: string;
  /** Adds a connection for every place one file uses another. */
  linkFiles(builder: GraphBuilder): void;
  /** Adds web routes, databases, services and settings, and how files reach them. */
  findSpecialParts(builder: GraphBuilder): Promise<void>;
}
