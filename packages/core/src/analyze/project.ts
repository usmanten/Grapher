import { Project, type SourceFile, ts } from 'ts-morph';

import type { FileRole } from '../graph/types.js';
import { ReadRefusedError, type SourceReader } from '../scan/reader.js';
import type { ScanResult } from '../scan/types.js';
import { fileRole, isCodeFile, isTestFile } from './next.js';

export interface AnalyzedFile {
  path: string;
  nodeId: string;
  role: FileRole;
  source: SourceFile;
  client: boolean;
}

export interface AnalysisContext {
  scan: ScanResult;
  reader: SourceReader;
  files: Map<string, AnalyzedFile>;
  /** Looks up an analyzed file from a ts-morph source file. */
  fileFor(source: SourceFile): AnalyzedFile | undefined;
  /** Dependencies declared in package.json. */
  dependencies: Set<string>;
  projectName: string;
  /** Files that could not be read or parsed, with a reason. */
  problems: { path: string; message: string }[];
}

/** Virtual root for the in-memory file system: `/app/page.tsx`, `/lib/db.ts`, ... */
const toVirtual = (path: string) => `/${path}`;
const fromVirtual = (path: string) => path.replace(/^\//, '');

export const fileNodeId = (path: string) => `file:${path}`;

async function readOptional(reader: SourceReader, scan: ScanResult, path: string) {
  if (!scan.files.some((f) => f.path === path)) return undefined;
  try {
    return await reader.read(path);
  } catch (error) {
    if (error instanceof ReadRefusedError) return undefined;
    throw error;
  }
}

interface PackageJson {
  name?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
}

function parsePackageJson(text: string | undefined) {
  const dependencies = new Set<string>();
  let name = '';
  if (text === undefined) return { name, dependencies };
  try {
    const pkg = JSON.parse(text) as PackageJson;
    if (typeof pkg.name === 'string') name = pkg.name;
    for (const field of [pkg.dependencies, pkg.devDependencies]) {
      if (field && typeof field === 'object') {
        for (const dep of Object.keys(field)) dependencies.add(dep);
      }
    }
  } catch {
    // A broken package.json shouldn't stop the analysis; we just learn less.
  }
  return { name, dependencies };
}

/**
 * Reads path aliases (like `@/*`) from tsconfig.json or jsconfig.json, so
 * imports such as `@/lib/db` resolve to the right file. `extends` is not
 * followed, to keep every read inside the project.
 */
function compilerPaths(text: string | undefined): ts.CompilerOptions {
  if (text === undefined) return {};
  const parsed = ts.parseConfigFileTextToJson('tsconfig.json', text);
  const options = (parsed.config as { compilerOptions?: Record<string, unknown> } | undefined)
    ?.compilerOptions;
  if (!options) return {};
  const result: ts.CompilerOptions = {};
  const baseUrl = typeof options.baseUrl === 'string' ? options.baseUrl : '.';
  // baseUrl is deprecated in TypeScript 6 but still how many Next.js projects anchor
  // their `paths`, so we keep honoring it to resolve their imports correctly.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  result.baseUrl = toVirtual(baseUrl).replace(/\/\.?$/, '') || '/';
  if (options.paths && typeof options.paths === 'object') {
    result.paths = options.paths as ts.MapLike<string[]>;
  }
  return result;
}

function directiveOf(source: SourceFile): 'use client' | 'use server' | undefined {
  const first = source.getStatements()[0];
  if (first?.getKind() !== ts.SyntaxKind.ExpressionStatement) return undefined;
  const text = first.getText().replace(/;$/, '').trim();
  if (text === "'use client'" || text === '"use client"') return 'use client';
  if (text === "'use server'" || text === '"use server"') return 'use server';
  return undefined;
}

/**
 * Loads the project's code into ts-morph through the safe reader.
 *
 * ts-morph runs on an in-memory file system holding only the files the
 * scanner approved, so the TypeScript compiler can't read anything else
 * from disk, including node_modules.
 */
export async function loadProject(
  scan: ScanResult,
  reader: SourceReader,
): Promise<AnalysisContext> {
  const problems: AnalysisContext['problems'] = [];
  const pkg = parsePackageJson(await readOptional(reader, scan, 'package.json'));
  const tsconfig =
    (await readOptional(reader, scan, 'tsconfig.json')) ??
    (await readOptional(reader, scan, 'jsconfig.json'));

  const project = new Project({
    useInMemoryFileSystem: true,
    skipLoadingLibFiles: true,
    compilerOptions: {
      allowJs: true,
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      noEmit: true,
      ...compilerPaths(tsconfig),
    },
  });

  const files = new Map<string, AnalyzedFile>();
  const byVirtualPath = new Map<string, AnalyzedFile>();
  for (const { path } of scan.files) {
    if (!isCodeFile(path) || isTestFile(path)) continue;
    let text: string;
    try {
      text = await reader.read(path);
    } catch (error) {
      problems.push({ path, message: (error as Error).message });
      continue;
    }
    const source = project.createSourceFile(toVirtual(path), text, { overwrite: true });
    const directive = directiveOf(source);
    const file: AnalyzedFile = {
      path,
      nodeId: fileNodeId(path),
      role: fileRole(path, directive),
      source,
      client: directive === 'use client',
    };
    files.set(path, file);
    byVirtualPath.set(source.getFilePath(), file);
  }

  return {
    scan,
    reader,
    files,
    fileFor: (source) =>
      byVirtualPath.get(source.getFilePath()) ?? files.get(fromVirtual(source.getFilePath())),
    dependencies: pkg.dependencies,
    projectName: pkg.name,
    problems,
  };
}
