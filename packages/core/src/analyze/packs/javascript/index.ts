import type { FileNode, GraphWarning, HttpMethod } from '../../../graph/types.js';
import type { GraphBuilder } from '../../builder.js';
import type { LanguagePack, LoadedPack, PackFile } from '../../pack.js';
import { detectDrizzle, detectPrisma, detectSupabase } from './detectors/databases.js';
import { detectImports, type PackageImport } from './detectors/imports.js';
import { detectNavigation } from './detectors/navigation.js';
import { detectPackages } from './detectors/packages.js';
import { detectRequests, type RouteTarget } from './detectors/requests.js';
import { connectSetting, detectSettings } from './detectors/settings.js';
import { isCodeFile, isInAppDir, isPagesRouterFile, urlPathFor } from './next.js';
import { type AnalysisContext, loadProject } from './project.js';

const HTTP_METHODS: readonly HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

/** The HTTP methods an API route file exports handlers for. */
function routeMethods(ctx: AnalysisContext, filePath: string): HttpMethod[] {
  const file = ctx.files.get(filePath);
  if (!file) return [];
  const exported = new Set(file.source.getExportedDeclarations().keys());
  return HTTP_METHODS.filter((m) => exported.has(m));
}

function fileNodes(ctx: AnalysisContext): {
  files: PackFile[];
  routes: RouteTarget[];
  pages: RouteTarget[];
} {
  const files: PackFile[] = [];
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
    files.push({ node, text: file.source.getFullText() });
  }
  return { files, routes, pages };
}

function hasAppRouter(ctx: AnalysisContext): boolean {
  return [...ctx.files.values()].some(
    (f) => isInAppDir(f.path) && (f.role === 'page' || f.role === 'route' || f.role === 'layout'),
  );
}

function frameworkWarnings(ctx: AnalysisContext, appRouter: boolean): GraphWarning[] {
  const warnings: GraphWarning[] = [];
  if (ctx.scan.files.some((f) => isPagesRouterFile(f.path))) {
    warnings.push({
      code: 'pages-router',
      message:
        'This project has a pages/ folder. Grapher maps the App Router (app/) only for now, so pages and API routes in pages/ appear as plain files.',
    });
  }
  // A project written in another language isn't a Next.js project missing its app/ folder.
  if (!appRouter && ctx.files.size > 0) {
    warnings.push({
      code: 'no-app-router',
      message:
        'No Next.js app/ folder was found. Grapher still maps imports, but it is built for App Router projects.',
    });
  }
  return warnings;
}

/**
 * JavaScript and TypeScript, parsed with ts-morph, with the Next.js App
 * Router as its framework.
 */
export const javascriptPack: LanguagePack = {
  id: 'javascript',
  name: 'JavaScript and TypeScript',
  claims: isCodeFile,

  async load({ scan, reader, paths, identified }): Promise<LoadedPack> {
    const ctx = await loadProject(scan, reader, paths);
    const { files, routes, pages } = fileNodes(ctx);
    const appRouter = hasAppRouter(ctx);
    let packageImports: PackageImport[] = [];

    return {
      files,
      problems: ctx.problems,
      warnings: frameworkWarnings(ctx, appRouter),
      ...(appRouter ? { framework: 'next-app-router' as const } : {}),
      ...(ctx.projectName ? { projectName: ctx.projectName } : {}),

      linkFiles(builder: GraphBuilder) {
        packageImports = detectImports(ctx, builder);
      },

      async findSpecialParts(builder: GraphBuilder) {
        detectRequests(ctx, builder, routes);
        detectNavigation(ctx, builder, pages);
        detectPackages(packageImports, builder, identified);
        detectSettings(ctx, builder);
        await detectPrisma(ctx, builder, (from, name, filePath, line) => {
          connectSetting(builder, from, name, { path: filePath, line });
        });
        detectDrizzle(ctx, builder);
        detectSupabase(ctx, builder);
      },
    };
  },
};
