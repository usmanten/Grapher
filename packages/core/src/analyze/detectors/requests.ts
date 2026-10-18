import { type CallExpression, type Node, SyntaxKind } from 'ts-morph';

import type { HttpMethod } from '../../graph/types.js';
import type { GraphBuilder } from '../builder.js';
import { matchRoute, UNKNOWN_SEGMENT } from '../next.js';
import type { AnalysisContext, AnalyzedFile } from '../project.js';
import { at, stringValue } from './shared.js';

const METHODS = new Set<string>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const AXIOS_METHOD = /^(?:axios|ky)\.(get|post|put|patch|delete|head|options)$/;

export interface RouteTarget {
  nodeId: string;
  urlPath: string;
}

/** Hosts that point back at the app itself during development. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

/**
 * The URL a request goes to, as far as the code shows. Template parts whose
 * value is only known at runtime become UNKNOWN_SEGMENT. A template that
 * starts with a variable (like `${baseUrl}/api/users`) is treated as a path
 * on the app itself.
 */
export function requestUrl(arg: Node | undefined): string | undefined {
  const literal = stringValue(arg);
  if (literal !== undefined) return literal;
  if (!arg?.isKind(SyntaxKind.TemplateExpression)) return undefined;
  let text = arg.getHead().getLiteralText();
  const spans = arg.getTemplateSpans();
  spans.forEach((span, index) => {
    const tail = span.getLiteral().getLiteralText();
    // A leading `${base}` before a path is the app's own origin.
    if (index === 0 && text === '' && tail.startsWith('/')) text = tail;
    else text += UNKNOWN_SEGMENT + tail;
  });
  return text;
}

function methodOf(call: CallExpression): HttpMethod {
  const callee = call.getExpression().getText();
  const axios = AXIOS_METHOD.exec(callee);
  if (axios?.[1]) return axios[1].toUpperCase() as HttpMethod;
  const options = call.getArguments()[1];
  if (options?.isKind(SyntaxKind.ObjectLiteralExpression)) {
    const method = options.getProperty('method');
    if (method?.isKind(SyntaxKind.PropertyAssignment)) {
      const value = stringValue(method.getInitializer())?.toUpperCase();
      if (value !== undefined && METHODS.has(value)) return value as HttpMethod;
    }
  }
  return 'GET';
}

function isRequestCall(call: CallExpression): boolean {
  const callee = call.getExpression().getText();
  return callee === 'fetch' || callee === 'axios' || AXIOS_METHOD.test(callee);
}

function pathOnly(url: string): string {
  return url.split(/[?#]/)[0] ?? url;
}

function connectRequest(
  builder: GraphBuilder,
  file: AnalyzedFile,
  call: CallExpression,
  url: string,
  routes: readonly RouteTarget[],
): void {
  // A login before `@` (like `https://token@host`) is skipped so it never becomes a label.
  const external = /^https?:\/\/(?:[^/?#@]*@)?([^/?#:@]+)/i.exec(url);
  if (external?.[1]) {
    const host = external[1].toLowerCase();
    if (LOCAL_HOSTS.has(host)) {
      connectRequest(builder, file, call, url.replace(/^https?:\/\/[^/]+/i, '') || '/', routes);
      return;
    }
    // Only the host is recorded: query strings can carry keys.
    const id = `service:${host}`;
    builder.addNode({ id, kind: 'service', label: host, source: host });
    builder.connect({
      from: file.nodeId,
      to: id,
      kind: 'uses-service',
      location: at(file, call, 'use'),
    });
    return;
  }
  if (!url.startsWith('/')) return;

  let best: { route: RouteTarget; score: number } | undefined;
  for (const route of routes) {
    const score = matchRoute(route.urlPath, pathOnly(url));
    if (score !== undefined && (best === undefined || score > best.score)) best = { route, score };
  }
  if (!best) return;
  builder.connect({
    from: file.nodeId,
    to: best.route.nodeId,
    kind: 'requests',
    detail: methodOf(call),
    location: at(file, call, 'use'),
  });
}

/**
 * Finds `fetch` and axios calls, and links them to the API route they reach,
 * or to an outside web service by host name.
 */
export function detectRequests(
  ctx: AnalysisContext,
  builder: GraphBuilder,
  routes: readonly RouteTarget[],
): void {
  for (const file of ctx.files.values()) {
    for (const call of file.source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (!isRequestCall(call)) continue;
      const url = requestUrl(call.getArguments()[0]);
      if (url !== undefined) connectRequest(builder, file, call, url, routes);
    }
  }
}
