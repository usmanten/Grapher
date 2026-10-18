import { type Node, SyntaxKind } from 'ts-morph';

import type { GraphBuilder } from '../builder.js';
import { matchRoute } from '../next.js';
import type { AnalysisContext, AnalyzedFile } from '../project.js';
import { requestUrl, type RouteTarget } from './requests.js';
import { at } from './shared.js';

/** `router.push('/x')`, `router.replace('/x')`. */
const ROUTER_METHOD = /^\w*router\w*\.(?:push|replace)$/i;
/** Next.js functions that send the browser to another page. */
const REDIRECTS = new Set(['redirect', 'permanentRedirect']);
/**
 * Object keys that hold a page address: menu items like `{ href: '/about' }`,
 * and addresses handed to services, like Stripe's `success_url` or `callbackUrl`.
 */
const URL_KEY = /^href$|(?:^|_)url$|[a-z]Url$|URL$/;
/** Special Next.js files that list pages for search engines instead of linking to them. */
const LISTING_FILE = /(?:^|\/)(?:sitemap|robots|manifest)\.[cm]?[jt]sx?$/;

function pathOnly(url: string): string {
  return url.split(/[?#]/)[0] ?? url;
}

/** The page a path leads to, if it is one of the app's own pages. */
function pageFor(url: string | undefined, pages: readonly RouteTarget[]): RouteTarget | undefined {
  if (url?.startsWith('/') !== true || url.startsWith('//')) return undefined;
  let best: { page: RouteTarget; score: number } | undefined;
  for (const page of pages) {
    const score = matchRoute(page.urlPath, pathOnly(url));
    if (score !== undefined && (best === undefined || score > best.score)) best = { page, score };
  }
  return best?.page;
}

/** Where a node sends the user, from `href=`, a router or redirect call, or a URL setting. */
function destination(node: Node): Node | undefined {
  if (node.isKind(SyntaxKind.JsxAttribute)) {
    if (node.getNameNode().getText() !== 'href') return undefined;
    const value = node.getInitializer();
    return value?.isKind(SyntaxKind.JsxExpression) ? value.getExpression() : value;
  }
  if (node.isKind(SyntaxKind.CallExpression)) {
    const callee = node.getExpression().getText();
    return REDIRECTS.has(callee) || ROUTER_METHOD.test(callee) ? node.getArguments()[0] : undefined;
  }
  if (node.isKind(SyntaxKind.PropertyAssignment)) {
    return URL_KEY.test(node.getName()) ? node.getInitializer() : undefined;
  }
  return undefined;
}

/**
 * Finds links and redirects to the app's own pages: `<Link href="/about">`,
 * `router.push('/dashboard')`, `redirect('/login')`, and addresses handed to
 * outside services, like a checkout's `success_url`.
 */
export function detectNavigation(
  ctx: AnalysisContext,
  builder: GraphBuilder,
  pages: readonly RouteTarget[],
): void {
  if (pages.length === 0) return;
  const linkKinds = [
    SyntaxKind.JsxAttribute,
    SyntaxKind.CallExpression,
    SyntaxKind.PropertyAssignment,
  ] as const;
  for (const file of ctx.files.values()) {
    if (LISTING_FILE.test(file.path)) continue;
    for (const kind of linkKinds) {
      for (const node of file.source.getDescendantsOfKind(kind)) {
        const target = destination(node);
        if (target === undefined) continue;
        const page = pageFor(requestUrl(target), pages);
        if (page) connectPage(builder, file, node, page);
      }
    }
  }
}

function connectPage(
  builder: GraphBuilder,
  file: AnalyzedFile,
  node: Node,
  page: RouteTarget,
): void {
  builder.connect({
    from: file.nodeId,
    to: page.nodeId,
    kind: 'links',
    location: at(file, node, 'use'),
  });
}
