import type { LanguagePack } from '../pack.js';
import { javascriptPack } from './javascript/index.js';

/** The language packs Grapher uses, in order of priority. */
export const DEFAULT_PACKS: readonly LanguagePack[] = [javascriptPack];
