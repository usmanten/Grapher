import type { GraphBuilder } from '../../builder.js';
import { fileNodeId, type LanguagePack, type LoadedPack, type PackFile } from '../../pack.js';
import { type BasicLanguage, languageFor, type LinkContext } from './languages.js';
import { parserFor } from './parser.js';
import { basename, dirname, FileIndex, type ImportRef } from './resolve.js';

/**
 * A basic map for languages without a full pack: which file uses which,
 * read with Tree-sitter. It finds no routes, databases, services or
 * settings; a full pack for the language adds those.
 */
export const basicPack: LanguagePack = {
  id: 'basic',
  name: 'Other languages (basic)',
  claims: (filePath) => languageFor(filePath) !== undefined,

  async load({ scan, reader, paths }): Promise<LoadedPack> {
    const problems: LoadedPack['problems'] = [];
    const files: PackFile[] = [];
    const imports = new Map<string, { language: BasicLanguage; refs: ImportRef[] }>();
    const kept = paths.filter((p) => !languageFor(p)?.isTest(p));

    const goModules: LinkContext['goModules'] = [];
    for (const { path: filePath } of scan.files) {
      if (basename(filePath) !== 'go.mod') continue;
      const module = /^module\s+(\S+)/m.exec(await reader.read(filePath).catch(() => ''))?.[1];
      if (module) goModules.push({ dir: dirname(filePath), module });
    }
    const ctx: LinkContext = { index: new FileIndex(kept), goModules };

    for (const filePath of kept) {
      const language = languageFor(filePath);
      if (!language) continue;
      let text: string;
      try {
        text = await reader.read(filePath);
      } catch (error) {
        problems.push({ path: filePath, message: (error as Error).message });
        continue;
      }
      const tree = (await parserFor(language.grammar)).parse(text);
      if (!tree) {
        problems.push({ path: filePath, message: 'Could not be parsed.' });
        continue;
      }
      imports.set(filePath, { language, refs: language.imports(tree.rootNode, filePath, ctx) });
      tree.delete();
      files.push({
        node: { id: fileNodeId(filePath), kind: 'file', path: filePath, role: 'module' },
        text,
      });
    }

    return {
      files,
      problems,
      warnings: [],

      linkFiles(builder: GraphBuilder) {
        for (const [from, { language, refs }] of imports) {
          const sameLanguage = (p: string) => languageFor(p) === language;
          for (const ref of refs) {
            for (const to of ctx.index.resolve(from, ref.candidates, sameLanguage)) {
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

      findSpecialParts() {
        return Promise.resolve();
      },
    };
  },
};
