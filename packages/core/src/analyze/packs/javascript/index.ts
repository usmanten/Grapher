import { type Node, SyntaxKind } from 'ts-morph';

import type { FileNode, Graph, GraphWarning, HttpMethod } from '../../../graph/types.js';
import type { GraphBuilder } from '../../builder.js';
import type { LanguagePack, LoadedPack, PackFile } from '../../pack.js';
import { detectDrizzle, detectPrisma, detectSupabase } from './detectors/databases.js';
import { detectImports, type PackageImport } from './detectors/imports.js';
import { detectNavigation } from './detectors/navigation.js';
import { detectPackages } from './detectors/packages.js';
import { detectRequests, type RouteTarget } from './detectors/requests.js';
import { connectSetting, detectSettings } from './detectors/settings.js';
import { isCodeFile, isInAppDir, isInPagesDir, urlPathFor } from './next.js';
import { type AnalysisContext, type AnalyzedFile, loadProject } from './project.js';

const HTTP_METHODS: readonly HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

const isMethod = (text: string | undefined): text is HttpMethod =>
  HTTP_METHODS.includes(text as HttpMethod);

const isRequestMethod = (node: Node | undefined): boolean =>
  node?.isKind(SyntaxKind.PropertyAccessExpression) === true && node.getName() === 'method';

function methodLiteral(node: Node | undefined): HttpMethod | undefined {
  if (!node?.isKind(SyntaxKind.StringLiteral)) return undefined;
  const text = node.getLiteralText().toUpperCase();
  return isMethod(text) ? text : undefined;
}

/**
 * The HTTP methods a Pages Router API route checks for. Its one handler
 * branches on `req.method`: `req.method === 'POST'`, `switch (req.method)`
 * with `case 'GET':`, or `['GET', 'POST'].includes(req.method)`.
 */
function checkedMethods(file: AnalyzedFile): Set<HttpMethod> {
  const found = new Set<HttpMethod>();
  const add = (node: Node | undefined) => {
    const method = methodLiteral(node);
    if (method) found.add(method);
  };
  for (const node of file.source.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (isRequestMethod(node.getLeft())) add(node.getRight());
    if (isRequestMethod(node.getRight())) add(node.getLeft());
  }
  for (const node of file.source.getDescendantsOfKind(SyntaxKind.SwitchStatement)) {
    if (!isRequestMethod(node.getExpression())) continue;
    for (const clause of node.getCaseBlock().getClauses()) {
      if (clause.isKind(SyntaxKind.CaseClause)) add(clause.getExpression());
    }
  }
  for (const call of file.source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!callee.isKind(SyntaxKind.PropertyAccessExpression) || callee.getName() !== 'includes')
      continue;
    if (!isRequestMethod(call.getArguments()[0])) continue;
    const list = callee.getExpression();
    if (list.isKind(SyntaxKind.ArrayLiteralExpression)) list.getElements().forEach(add);
  }
  return found;
}

/**
 * The HTTP methods an API route handles. An App Router route exports one
 * function per method; a Pages Router route checks `req.method` instead.
 */
function routeMethods(file: AnalyzedFile): HttpMethod[] {
  const handled = isInPagesDir(file.path)
    ? checkedMethods(file)
    : new Set(file.source.getExportedDeclarations().keys());
  return HTTP_METHODS.filter((m) => handled.has(m));
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
      node.methods = routeMethods(file);
      routes.push({ nodeId: file.nodeId, urlPath: node.urlPath ?? '/' });
    }
    if (file.role === 'page') pages.push({ nodeId: file.nodeId, urlPath: node.urlPath ?? '/' });
    if (file.client) node.client = true;
    files.push({ node, text: file.source.getFullText() });
  }
  return { files, routes, pages };
}

type NextRouter = Exclude<Graph['project']['framework'], 'unknown'>;

/**
 * Which Next.js router the project uses. A project moving from one to the
 * other can have both; it counts as App Router, the one Next.js recommends.
 */
function nextRouter(ctx: AnalysisContext): NextRouter | undefined {
  const routed = [...ctx.files.values()].filter(
    (f) => f.role === 'page' || f.role === 'route' || f.role === 'layout',
  );
  if (routed.some((f) => isInAppDir(f.path))) return 'next-app-router';
  if (routed.some((f) => isInPagesDir(f.path))) return 'next-pages-router';
  return undefined;
}

function frameworkWarnings(ctx: AnalysisContext, router: NextRouter | undefined): GraphWarning[] {
  // A project written in another language isn't a Next.js project missing its app/ folder.
  if (router || ctx.files.size === 0) return [];
  return [
    {
      code: 'no-next-router',
      message:
        'No Next.js app/ or pages/ folder was found. Grapher still maps imports, but it is built for Next.js projects.',
    },
  ];
}

/**
 * JavaScript and TypeScript, parsed with ts-morph, with Next.js (App Router
 * and Pages Router) as its framework.
 */
export const javascriptPack: LanguagePack = {
  id: 'javascript',
  name: 'JavaScript and TypeScript',
  claims: isCodeFile,

  async load({ scan, reader, paths, identified }): Promise<LoadedPack> {
    const ctx = await loadProject(scan, reader, paths);
    const { files, routes, pages } = fileNodes(ctx);
    const router = nextRouter(ctx);
    let packageImports: PackageImport[] = [];

    return {
      files,
      problems: ctx.problems,
      warnings: frameworkWarnings(ctx, router),
      ...(router ? { framework: router } : {}),
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
