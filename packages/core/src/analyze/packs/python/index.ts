import type { FileNode, WebRoute } from '../../../graph/types.js';
import type { GraphBuilder } from '../../builder.js';
import {
  fileNodeId,
  type LanguagePack,
  type LoadedPack,
  type PackFile,
  type PackInput,
} from '../../pack.js';
import { python } from '../basic/languages.js';
import { parserFor } from '../basic/parser.js';
import { basename, FileIndex } from '../basic/resolve.js';
import { detectDatabases } from './databases.js';
import { detectPackages } from './packages.js';
import { Findings, makeFile, type PyFile, PyProject } from './project.js';
import { detectRoutes, type UrlInclude } from './routes.js';
import { detectRequests, detectSettings } from './settings.js';

/** Django migrations and Alembic versions are generated history, not the app's own code. */
const isGenerated = (p: string) =>
  /(?:^|\/)migrations\//.test(p) || /(?:^|\/)alembic\/versions\//.test(p);

/** Files that list a project's packages, used to spot database drivers. */
const isDependencyFile = (p: string) =>
  /^requirements[\w.-]*\.txt$/.test(basename(p)) ||
  ['pyproject.toml', 'Pipfile', 'setup.cfg'].includes(basename(p));

async function readDependencies({
  scan,
  reader,
}: PackInput): Promise<{ text: string; name?: string }> {
  let text = '';
  let name: string | undefined;
  for (const { path } of scan.files) {
    if (!isDependencyFile(path)) continue;
    const content = await reader.read(path).catch(() => '');
    text += `${content}\n`;
    if (path === 'pyproject.toml') {
      name = /^\[(?:project|tool\.poetry)\][^[]*?^name\s*=\s*["']([^"']+)["']/m.exec(content)?.[1];
    }
  }
  return name === undefined ? { text } : { text, name };
}

/** Django's settings file holds the project's configuration, so it is shown as one. */
const isSettingsFile = (file: PyFile) =>
  file.defined.has('INSTALLED_APPS') || file.defined.has('DATABASES');

function fileNode(file: PyFile, routes: WebRoute[] | undefined): FileNode {
  const node: FileNode = { id: file.nodeId, kind: 'file', path: file.path, role: 'module' };
  if (routes && routes.length > 0) {
    node.role = 'route';
    node.routes = routes;
    // Methods are listed only when every route names them; an empty list means any method.
    if (routes.every((r) => r.methods.length > 0)) {
      node.methods = [...new Set(routes.flatMap((r) => r.methods))];
    }
    if (routes.length === 1 && routes[0]) node.urlPath = routes[0].path;
  } else if (isSettingsFile(file)) {
    node.role = 'config';
  }
  return node;
}

/**
 * Python, read with Tree-sitter: which file uses which, web routes in
 * Flask, FastAPI and Django, databases through SQLAlchemy and the Django
 * ORM, outside services and environment settings.
 */
export const pythonPack: LanguagePack = {
  id: 'python',
  name: 'Python',
  claims: (filePath) => filePath.endsWith('.py'),

  async load(input): Promise<LoadedPack> {
    const { reader, paths, identified } = input;
    const problems: LoadedPack['problems'] = [];
    const kept = paths.filter((p) => !python.isTest(p) && !isGenerated(p));
    const index = new FileIndex(kept);
    const parser = await parserFor(python.grammar);
    const dependencies = kept.length > 0 ? await readDependencies(input) : { text: '' };

    const files = new Map<string, PyFile>();
    const trees: { delete(): void }[] = [];
    const findings = new Findings();
    let packFiles: PackFile[];
    let framework: LoadedPack['framework'];
    let includes: UrlInclude[] = [];
    // Syntax trees live in WebAssembly memory, so they are freed by hand once read.
    try {
      for (const filePath of kept) {
        let text: string;
        try {
          text = await reader.read(filePath);
        } catch (error) {
          problems.push({ path: filePath, message: (error as Error).message });
          continue;
        }
        const tree = parser.parse(text);
        if (!tree) {
          problems.push({ path: filePath, message: 'Could not be parsed.' });
          continue;
        }
        trees.push(tree);
        const refs = python.imports(tree.rootNode, filePath, { index, goModules: [] });
        files.set(filePath, makeFile(filePath, text, tree.rootNode, refs));
      }

      const project = new PyProject(files, index);
      const found = detectRoutes(project);
      framework = found.framework;
      includes = found.includes;
      detectDatabases(project, findings, dependencies.text);
      detectPackages(project, findings, identified);
      for (const file of files.values()) {
        detectSettings(file, findings);
        detectRequests(file, findings);
      }
      packFiles = [...files.values()].map((file) => ({
        node: fileNode(file, found.routes.get(file.path)),
        text: file.text,
      }));
    } finally {
      for (const tree of trees) tree.delete();
    }

    const isPython = (p: string) => p.endsWith('.py');
    return {
      files: packFiles,
      problems,
      warnings: [],
      ...(framework ? { framework } : {}),
      ...(dependencies.name === undefined ? {} : { projectName: dependencies.name }),

      linkFiles(builder: GraphBuilder) {
        for (const { path: from, refs } of files.values()) {
          for (const ref of refs) {
            for (const to of index.resolve(from, ref.candidates, isPython)) {
              builder.connect({
                from: fileNodeId(from),
                to: fileNodeId(to),
                kind: 'uses',
                name: ref.name,
                location: { path: from, line: ref.line, role: 'import' },
              });
            }
          }
        }
      },

      findSpecialParts(builder: GraphBuilder) {
        for (const include of includes) {
          builder.connect({
            from: fileNodeId(include.from),
            to: fileNodeId(include.to),
            kind: 'uses',
            name: include.module,
            location: { path: include.from, line: include.line, role: 'use' },
          });
        }
        findings.replay(builder);
        return Promise.resolve();
      },
    };
  },
};
