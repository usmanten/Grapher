import type { LanguagePack } from '../pack.js';
import { basicPack } from './basic/index.js';
import { javascriptPack } from './javascript/index.js';
import { pythonPack } from './python/index.js';

/**
 * The language packs Grapher uses, in order of priority: a file goes to the
 * first pack that claims it. The basic pack comes last, so a full pack for a
 * language takes its files over as soon as it is added.
 */
export const DEFAULT_PACKS: readonly LanguagePack[] = [javascriptPack, pythonPack, basicPack];
