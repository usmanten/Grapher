import type { Node } from '@vscode/tree-sitter-wasm';

import type { HttpMethod, WebRoute } from '../../../graph/types.js';
import type { PyFile, PyProject, Target } from './project.js';
import {
  all,
  assignedCalls,
  calleeText,
  keywordArg,
  lastPart,
  lineOf,
  positionalArgs,
  present,
  stringList,
  stringValue,
} from './syntax.js';

const HTTP_METHODS = new Set<string>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const VERB_DECORATORS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

type AppKind = 'flask' | 'fastapi';

/** A Flask app or blueprint, or a FastAPI app or router: something routes are added to. */
interface AppObject {
  path: string;
  name: string;
  kind: AppKind;
  /** The prefix the object adds to its own routes, like `url_prefix='/auth'`. */
  prefix: string;
}

/** `parent.register_blueprint(child, url_prefix=...)` or `parent.include_router(child, prefix=...)`. */
interface Mount {
  parent?: AppObject;
  child: AppObject;
  prefix?: string;
}

const CONSTRUCTORS: Record<string, { kind: AppKind; prefixArg?: string }> = {
  Flask: { kind: 'flask' },
  Blueprint: { kind: 'flask', prefixArg: 'url_prefix' },
  FastAPI: { kind: 'fastapi' },
  APIRouter: { kind: 'fastapi', prefixArg: 'prefix' },
};

/** A Django urls file handing addresses to another with `include('blog.urls')`. */
export interface UrlInclude {
  from: string;
  to: string;
  line: number;
  /** The module named in the include, like `blog.urls`. */
  module: string;
}

export interface RouteResult {
  /** The web addresses each file answers. */
  routes: Map<string, WebRoute[]>;
  /** Includes by module name, which no import statement shows. */
  includes: UrlInclude[];
  framework?: 'flask' | 'fastapi' | 'django';
}

/** Joins URL pieces with single slashes, always starting with `/`. */
export function joinUrl(...pieces: string[]): string {
  const joined = pieces
    .filter((p) => p !== '')
    .join('/')
    .replace(/\/{2,}/g, '/');
  return joined.startsWith('/') ? joined : `/${joined}`;
}

function methodsFrom(node: Node | undefined): HttpMethod[] {
  return stringList(node)
    .map((m) => m.toUpperCase())
    .filter((m): m is HttpMethod => HTTP_METHODS.has(m));
}

function addRoute(result: Map<string, WebRoute[]>, path: string, route: WebRoute): void {
  const list = result.get(path) ?? [];
  const same = list.find((r) => r.path === route.path);
  if (same) {
    same.methods = [...new Set([...same.methods, ...route.methods])];
  } else {
    list.push(route);
  }
  result.set(path, list);
}

class AppIndex {
  readonly objects: AppObject[] = [];

  constructor(private readonly project: PyProject) {
    for (const file of project.files.values()) {
      for (const { name, call } of assignedCalls(file.root)) {
        const constructor = CONSTRUCTORS[lastPart(calleeText(call))];
        if (!constructor) continue;
        const prefixNode = constructor.prefixArg
          ? keywordArg(call, constructor.prefixArg)
          : undefined;
        this.objects.push({
          path: file.path,
          name,
          kind: constructor.kind,
          prefix: stringValue(prefixNode) ?? '',
        });
      }
    }
  }

  find(target: Target | undefined): AppObject | undefined {
    if (target?.name === undefined) return undefined;
    return this.objects.find((o) => o.path === target.path && o.name === target.name);
  }

  /** The app object a name in a file refers to, like `bp` or `auth.router`. */
  resolve(file: PyFile, expr: string): AppObject | undefined {
    return this.find(this.project.resolveName(file, expr));
  }
}

/** The full prefix in front of an object's routes, following how it was mounted. */
function fullPrefix(obj: AppObject, mounts: Mount[], seen = new Set<AppObject>()): string {
  const mount = mounts.find((m) => m.child === obj);
  if (!mount || seen.has(obj)) return obj.prefix;
  seen.add(obj);
  const parent = mount.parent ? fullPrefix(mount.parent, mounts, seen) : '';
  // Flask's url_prefix when registering replaces the blueprint's own; FastAPI adds them up.
  return obj.kind === 'flask'
    ? joinUrl(parent, mount.prefix ?? obj.prefix)
    : joinUrl(parent, mount.prefix ?? '', obj.prefix);
}

/**
 * Flask and FastAPI: routes are functions under decorators like
 * `@app.route('/users')`, `@bp.post('/login')` or `@router.get('/{id}')`.
 * Blueprint and router prefixes are added, including the prefix given when
 * they are registered in another file.
 */
function decoratorRoutes(project: PyProject, result: Map<string, WebRoute[]>): AppKind | undefined {
  const apps = new AppIndex(project);
  if (apps.objects.length === 0) return undefined;

  const mounts: Mount[] = [];
  for (const file of project.files.values()) {
    for (const call of all(file.root, 'call')) {
      const callee = calleeText(call);
      const method = lastPart(callee);
      if (method !== 'register_blueprint' && method !== 'include_router') continue;
      const childExpr = positionalArgs(call)[0]?.text;
      const child = childExpr === undefined ? undefined : apps.resolve(file, childExpr);
      if (!child) continue;
      const parentExpr = callee.slice(0, -method.length - 1);
      const parent = apps.resolve(file, parentExpr);
      const prefix = stringValue(
        keywordArg(call, method === 'include_router' ? 'prefix' : 'url_prefix'),
      );
      mounts.push({
        child,
        ...(parent ? { parent } : {}),
        ...(prefix === undefined ? {} : { prefix }),
      });
    }
  }

  for (const file of project.files.values()) {
    for (const decorator of all(file.root, 'decorator')) {
      const call = decorator.namedChild(0);
      if (call?.type !== 'call') continue;
      const callee = calleeText(call);
      const method = lastPart(callee);
      const objectExpr = callee.slice(0, -method.length - 1);
      if (objectExpr === '') continue;
      const obj = apps.resolve(file, objectExpr);
      // Routes on an object Grapher couldn't follow still count, without a prefix.
      if (!obj && method !== 'route' && method !== 'api_route' && !VERB_DECORATORS.has(method)) {
        continue;
      }
      let methods: HttpMethod[];
      if (VERB_DECORATORS.has(method)) methods = [method.toUpperCase() as HttpMethod];
      else if (method === 'route' || method === 'api_route') {
        const listed = methodsFrom(keywordArg(call, 'methods'));
        methods = listed.length > 0 ? listed : method === 'route' ? ['GET'] : [];
      } else continue;
      const routePath = stringValue(positionalArgs(call)[0] ?? keywordArg(call, 'path'));
      if (routePath === undefined) continue;
      const prefix = obj ? fullPrefix(obj, mounts) : '';
      addRoute(result, file.path, { path: joinUrl(prefix, routePath), methods });
    }
  }
  return apps.objects.some((o) => o.kind === 'fastapi') ? 'fastapi' : 'flask';
}

/** `^articles/(?P<year>[0-9]{4})/$` → `articles/(?P<year>[0-9]{4})/` */
const cleanPattern = (route: string) => route.replace(/^\^/, '').replace(/\$$/, '');

/** Methods a Django view limits itself to, from decorators like `@require_POST`. */
function viewMethods(project: PyProject, target: Target): HttpMethod[] {
  const file = project.files.get(target.path);
  if (!file || target.name === undefined) return [];
  for (const def of all(file.root, 'decorated_definition')) {
    const inner = def.childForFieldName('definition');
    if (inner?.childForFieldName('name')?.text !== target.name) continue;
    for (const decorator of present(def.namedChildren).filter((n) => n.type === 'decorator')) {
      const expr = decorator.namedChild(0);
      const name = lastPart(expr?.type === 'call' ? calleeText(expr) : (expr?.text ?? ''));
      const simple = /^require_(GET|POST|safe)$/.exec(name)?.[1];
      if (simple === 'safe') return ['GET', 'HEAD'];
      if (simple !== undefined) return [simple as HttpMethod];
      if ((name === 'require_http_methods' || name === 'api_view') && expr?.type === 'call') {
        return methodsFrom(positionalArgs(expr)[0]);
      }
    }
  }
  return [];
}

interface UrlEntry {
  route: string;
  /** A view function or class. */
  view?: Target;
  /** Another urls file, from `include('blog.urls')`. */
  include?: string;
}

/** The `path(...)` and `re_path(...)` entries of a Django urls file. */
function urlEntries(project: PyProject, file: PyFile, includes: UrlInclude[]): UrlEntry[] {
  const entries: UrlEntry[] = [];
  for (const call of all(file.root, 'call')) {
    const fn = lastPart(calleeText(call));
    if (fn !== 'path' && fn !== 're_path' && fn !== 'url') continue;
    const [routeNode, viewNode] = positionalArgs(call);
    const route = stringValue(routeNode);
    if (route === undefined || !viewNode) continue;
    const cleaned = fn === 'path' ? route : cleanPattern(route);

    if (viewNode.type === 'call' && lastPart(calleeText(viewNode)) === 'include') {
      const arg = positionalArgs(viewNode)[0];
      const module = stringValue(arg);
      const include =
        module !== undefined
          ? project.resolveModule(file.path, module)
          : arg
            ? project.resolveName(file, arg.text)?.path
            : undefined;
      if (include === undefined) continue;
      entries.push({ route: cleaned, include });
      if (module !== undefined) {
        includes.push({ from: file.path, to: include, line: lineOf(viewNode), module });
      }
      continue;
    }
    // `views.ArticleList.as_view()` is the ArticleList class.
    let viewExpr = viewNode;
    if (viewNode.type === 'call' && lastPart(calleeText(viewNode)) === 'as_view') {
      viewExpr = viewNode.childForFieldName('function')?.childForFieldName('object') ?? viewNode;
    }
    const target = project.resolveName(file, viewExpr.text);
    if (target) entries.push({ route: cleaned, view: target });
  }
  return entries;
}

/**
 * Django: routes are listed in `urlpatterns` in urls.py files, which point at
 * view functions and classes in other files, and at more urls files through
 * `include()`. The routes are put on the files that hold the views.
 */
function djangoRoutes(
  project: PyProject,
  result: Map<string, WebRoute[]>,
  includes: UrlInclude[],
): boolean {
  const urlFiles = new Map<string, UrlEntry[]>();
  for (const file of project.files.values()) {
    if (!file.defined.has('urlpatterns')) continue;
    urlFiles.set(file.path, urlEntries(project, file, includes));
  }
  if (urlFiles.size === 0) return false;

  const included = new Set(
    [...urlFiles.values()].flatMap((entries) => entries.flatMap((e) => e.include ?? [])),
  );
  const visit = (path: string, prefix: string, seen: Set<string>) => {
    if (seen.has(path)) return;
    seen.add(path);
    for (const entry of urlFiles.get(path) ?? []) {
      const url = joinUrl(prefix, entry.route);
      if (entry.include !== undefined) visit(entry.include, url, seen);
      else if (entry.view) {
        addRoute(result, entry.view.path, { path: url, methods: viewMethods(project, entry.view) });
      }
    }
  };
  const seen = new Set<string>();
  for (const path of [...urlFiles.keys()].sort()) {
    if (!included.has(path)) visit(path, '', seen);
  }
  return true;
}

/** Finds the web routes of Flask, FastAPI and Django apps. */
export function detectRoutes(project: PyProject): RouteResult {
  const routes = new Map<string, WebRoute[]>();
  const includes: UrlInclude[] = [];
  const django = djangoRoutes(project, routes, includes);
  const decorated = decoratorRoutes(project, routes);
  for (const list of routes.values()) {
    list.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
  const framework = django ? 'django' : decorated;
  return framework ? { routes, includes, framework } : { routes, includes };
}
