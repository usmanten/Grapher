import path from 'node:path';

import type { FileNode, Graph } from '../graph/types.js';
import { type FileSystem, nodeFileSystem } from '../scan/fs.js';
import { createSourceReader } from '../scan/reader.js';
import { scanProject } from '../scan/scan.js';
import type { ScanOptions, ScanResult } from '../scan/types.js';
import { GraphBuilder } from './builder.js';
import { detectDrizzle, detectPrisma, detectSupabase } from './detectors/databases.js';
import { detectImports } from './detectors/imports.js';
import { detectNavigation } from './detectors/navigation.js';
import { detectPackages } from './detectors/packages.js';
import { detectRequests, type RouteTarget } from './detectors/requests.js';
import { connectSetting, detectSettings } from './detectors/settings.js';
import { isInAppDir, isPagesRouterFile, urlPathFor } from './next.js';
import type { IdentifiedPackages } from './known-packages.js';
import { type AnalysisContext, loadProject } from './project.js';
import { addSnippets } from './snippets.js';
import { type HttpMethod } from '../graph/types.js';

const HTTP_METHODS: readonly HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

export interface AnalyzeOptions extends ScanOptions {
  /** Packages Claude identified by name in an earlier run. */
  identified?: IdentifiedPackages;
}

export interface AnalysisResult {
  graph: Graph;
  scan: ScanResult;
}

/** The HTTP methods an API route file exports handlers for. */
function routeMethods(ctx: AnalysisContext, filePath: string): HttpMethod[] {
  const file = ctx.files.get(filePath);
  if (!file) return [];
  const exported = new Set(file.source.getExportedDeclarations().keys());
  return HTTP_METHODS.filter((m) => exported.has(m));
}

function addFileNodes(
  ctx: AnalysisContext,
  builder: GraphBuilder,
): { routes: RouteTarget[]; pages: RouteTarget[] } {
  const routes: RouteTarget[] = [];
  const pages: RouteTarget[] = [];
  for (const file of ctx.files.values()) {
    const node: FileNode = { id: file.nodeId, kind: 'file', path: file.path, role: file.role };
    if (file.role === 'page' || file.role === 'route') node.urlPath = urlPathFor(file.path);
    if (file.role === 'route') {
      node.methods = routeMethods(ctx, file.path);
      routes.push({ nodeId: file.nodeId, urlPath: node.urlPath ?? '/' });
    }
    if (file.role === 'page') pages.push({ nodeId: file.nodeId, urlPath: node.urlPath ?? '/' });
    if (file.client) node.client = true;
    builder.addNode(node);
  }
  return { routes, pages };
}

function frameworkWarnings(
  ctx: AnalysisContext,
  builder: GraphBuilder,
): Graph['project']['framework'] {
  const paths = ctx.scan.files.map((f) => f.path);
  const hasAppRouter = [...ctx.files.values()].some(
    (f) => isInAppDir(f.path) && (f.role === 'page' || f.role === 'route' || f.role === 'layout'),
  );
  if (paths.some(isPagesRouterFile)) {
    builder.warn({
      code: 'pages-router',
      message:
        'This project has a pages/ folder. Grapher maps the App Router (app/) only for now, so pages and API routes in pages/ appear as plain files.',
    });
  }
  if (!hasAppRouter) {
    builder.warn({
      code: 'no-app-router',
      message:
        'No Next.js app/ folder was found. Grapher still maps imports, but it is built for App Router projects.',
    });
  }
  if (ctx.scan.truncated) {
    builder.warn({
      code: 'truncated',
      message: 'The project has more files than the limit, so only part of it was mapped.',
    });
  }
  for (const problem of ctx.problems) {
    builder.warn({ code: 'parse-error', message: `${problem.path}: ${problem.message}` });
  }
  return hasAppRouter ? 'next-app-router' : 'unknown';
}

/**
 * Scans a project and maps how its files, databases, outside services and
 * settings connect. Every file read goes through the safe reader, and no
 * network request is made.
 */
export async function analyzeProject(
  projectDir: string,
  options: AnalyzeOptions = {},
  fs: FileSystem = nodeFileSystem,
): Promise<AnalysisResult> {
  const scan = await scanProject(projectDir, options, fs);
  const reader = createSourceReader(scan, fs);
  const ctx = await loadProject(scan, reader);
  const builder = new GraphBuilder();

  const { routes, pages } = addFileNodes(ctx, builder);
  const framework = frameworkWarnings(ctx, builder);
  const packageImports = detectImports(ctx, builder);
  detectRequests(ctx, builder, routes);
  detectNavigation(ctx, builder, pages);
  detectPackages(packageImports, builder, options.identified);
  detectSettings(ctx, builder);
  await detectPrisma(ctx, builder, (from, name, filePath, line) => {
    connectSetting(builder, from, name, { path: filePath, line });
  });
  detectDrizzle(ctx, builder);
  detectSupabase(ctx, builder);

  const name = ctx.projectName || path.basename(scan.root);
  const graph = builder.build({ name, framework });
  addSnippets(graph, ctx.files);
  return { graph, scan };
}
