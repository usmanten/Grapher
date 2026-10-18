import type { FileRole } from '../graph/types.js';

const CODE_FILE = /\.(tsx?|jsx?|mts|cts|mjs|cjs)$/;
const APP_DIR = /^(?:src\/)?app\//;

/** True for files Grapher parses: JavaScript and TypeScript, but not type declarations. */
export function isCodeFile(path: string): boolean {
  return CODE_FILE.test(path) && !path.endsWith('.d.ts');
}

/** Test files check the app but are not part of it, so they stay off the map. */
export function isTestFile(path: string): boolean {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) || /(?:^|\/)__tests__\//.test(path);
}

export function isInAppDir(path: string): boolean {
  return APP_DIR.test(path);
}

/** True for files in a Pages Router `pages/` folder, which Grapher doesn't map yet. */
export function isPagesRouterFile(path: string): boolean {
  return /^(?:src\/)?pages\//.test(path) && isCodeFile(path);
}

function fileStem(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.[^.]+$/, '');
}

/** Decides what a file does, from its path and whether it starts with a directive. */
export function fileRole(
  path: string,
  directive: 'use client' | 'use server' | undefined,
): FileRole {
  const stem = fileStem(path);
  if (isInAppDir(path)) {
    if (stem === 'page') return 'page';
    if (stem === 'layout' || stem === 'template') return 'layout';
    if (stem === 'route') return 'route';
  }
  if (/^(?:src\/)?middleware$/.test(path.replace(/\.[^.]+$/, ''))) return 'middleware';
  if (stem.endsWith('.config') || stem === 'instrumentation') return 'config';
  if (directive === 'use server') return 'server-actions';
  return /\.(tsx|jsx)$/.test(path) ? 'component' : 'module';
}

/**
 * The URL a page or route answers. Route groups like `(marketing)` and
 * parallel route slots like `@modal` don't appear in the URL.
 */
export function urlPathFor(path: string): string {
  const segments = path.replace(APP_DIR, '').split('/').slice(0, -1);
  const visible = segments.filter(
    (s) => !(s.startsWith('(') && s.endsWith(')')) && !s.startsWith('@'),
  );
  return `/${visible.join('/')}`;
}

type RouteSegment =
  | { type: 'static'; value: string }
  | { type: 'dynamic' }
  | { type: 'catch-all'; optional: boolean };

function parseRouteSegment(segment: string): RouteSegment {
  if (segment.startsWith('[[...') && segment.endsWith(']]'))
    return { type: 'catch-all', optional: true };
  if (segment.startsWith('[...') && segment.endsWith(']'))
    return { type: 'catch-all', optional: false };
  if (segment.startsWith('[') && segment.endsWith(']')) return { type: 'dynamic' };
  return { type: 'static', value: segment };
}

/** Marks a request path segment whose value isn't known until runtime, like `${id}`. */
export const UNKNOWN_SEGMENT = '\u0000';

function splitPath(urlPath: string): string[] {
  return urlPath.split('/').filter((s) => s !== '');
}

/**
 * Scores how well a request path matches a route's URL pattern: higher means
 * more specific, undefined means no match. Static segments beat dynamic ones,
 * the way Next.js picks routes.
 */
export function matchRoute(routeUrl: string, requestPath: string): number | undefined {
  const pattern = splitPath(routeUrl).map(parseRouteSegment);
  const actual = splitPath(requestPath);
  let score = 0;

  for (let i = 0; i < pattern.length; i++) {
    const segment = pattern[i];
    const value = actual[i];
    if (segment === undefined) break;
    if (segment.type === 'catch-all') {
      const rest = actual.length - i;
      return rest > 0 || segment.optional ? score : undefined;
    }
    if (value === undefined) return undefined;
    if (segment.type === 'dynamic') {
      score += 1;
    } else if (value === segment.value) {
      score += 2;
    } else {
      return undefined;
    }
  }
  return actual.length === pattern.length ? score : undefined;
}
