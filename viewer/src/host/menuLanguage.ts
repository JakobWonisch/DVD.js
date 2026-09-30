/**
 * Menu language preference + switching for multi-LU discs.
 *
 * Default order when starting a disc: last selected (localStorage) → en → first
 * available IFO language unit on that disc.
 *
 * Host toolbar LU picker is hidden for now (confused some discs); keep these
 * helpers for auto-pick / setMenuLanguage. Single-LU discs with an on-disc
 * language menu (Avatar EUR) need no host switcher — the disc already offers
 * Deutsch/English/… as menu buttons.
 */

import type { DiscMetadata } from '../types/metadata.js';
import {
  MENU_LANG_STORAGE_KEY,
  MENU_LANG_STORAGE_KEY_LEGACY,
} from '../projectId.js';

export { MENU_LANG_STORAGE_KEY };

/** DVD lang_code 0xFFFF (bit2str → "ÿÿ") — unspecified VMGM LU. */
export const UNSPECIFIED_MENU_LANG = 'default';

/**
 * Normalize IFO/VM menu lang keys for UI and runtime.
 * Maps "ÿÿ" / non-ISO codes to "default".
 */
export function normalizeMenuLangCode(code: string | null | undefined): string {
  if (code == null || code === '') {
    return UNSPECIFIED_MENU_LANG;
  }
  if (
    code === 'ÿÿ' ||
    code === UNSPECIFIED_MENU_LANG ||
    (code.length === 2 &&
      code.charCodeAt(0) === 0xff &&
      code.charCodeAt(1) === 0xff)
  ) {
    return UNSPECIFIED_MENU_LANG;
  }
  const lower = String(code).trim().toLowerCase();
  if (lower === UNSPECIFIED_MENU_LANG) {
    return UNSPECIFIED_MENU_LANG;
  }
  if (/^[a-z]{2,3}$/.test(lower)) {
    return lower;
  }
  return UNSPECIFIED_MENU_LANG;
}

type VmLangGlobals = {
  lang?: string;
  domain?: number;
  sprm?: Record<string, number>;
  MPGCIUT?: Array<Record<string, unknown> | undefined>;
  MENU_TYPES?: Array<Record<string, unknown> | undefined>;
};

/** ISO-639-ish lang keys on MPGCIUT/MENU_TYPES entries (skip array indices). */
export function menuLangKeys(obj: unknown): string[] {
  if (!obj || typeof obj !== 'object') {
    return [];
  }
  const seen = new Set<string>();
  for (const k of Object.keys(obj as object)) {
    if (/^\d+$/.test(k)) continue;
    seen.add(normalizeMenuLangCode(k));
  }
  return [...seen];
}

export function getStoredMenuLang(
  storage: Pick<Storage, 'getItem'> | null | undefined = defaultStorage(),
): string | null {
  if (!storage) {
    return null;
  }
  try {
    const raw =
      storage.getItem(MENU_LANG_STORAGE_KEY) ??
      storage.getItem(MENU_LANG_STORAGE_KEY_LEGACY);
    if (!raw || typeof raw !== 'string') {
      return null;
    }
    const lang = normalizeMenuLangCode(raw.trim().toLowerCase());
    if (lang === UNSPECIFIED_MENU_LANG) {
      return lang;
    }
    return /^[a-z]{2,3}$/.test(lang) ? lang : null;
  } catch {
    return null;
  }
}

export function setStoredMenuLang(
  lang: string,
  storage: Pick<Storage, 'setItem'> | null | undefined = defaultStorage(),
): void {
  if (!storage || !lang) {
    return;
  }
  try {
    storage.setItem(MENU_LANG_STORAGE_KEY, lang.toLowerCase());
  } catch {
    // private mode / quota — ignore
  }
}

function defaultStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Choose from available menu langs: last selected → en → first.
 * When `prefer` is set and present (current session lang), keep it.
 */
export function resolveMenuLang(
  candidates: string[],
  opts: {
    prefer?: string | null;
    stored?: string | null;
  } = {},
): string {
  const keys = candidates.filter(Boolean);
  if (!keys.length) {
    return opts.prefer || opts.stored || 'en';
  }
  if (opts.prefer && keys.includes(opts.prefer)) {
    return opts.prefer;
  }
  const stored =
    opts.stored !== undefined ? opts.stored : getStoredMenuLang();
  if (stored && keys.includes(stored)) {
    return stored;
  }
  if (keys.includes('en')) {
    return 'en';
  }
  return keys[0];
}

/** Langs present for a menu domain (MPGCIUT first, else MENU_TYPES). */
export function domainMenuLangs(
  g: VmLangGlobals,
  domain = 0,
): string[] {
  const fromMpg = menuLangKeys(g.MPGCIUT?.[domain]);
  if (fromMpg.length) {
    return fromMpg;
  }
  return menuLangKeys(g.MENU_TYPES?.[domain]);
}

/**
 * Pick a language that exists for the given menu domain.
 * Prefer current g.lang when valid; else last selected → en → first.
 */
export function pickMenuLang(g: VmLangGlobals, domain = 0): string {
  const candidates = domainMenuLangs(g, domain);
  return resolveMenuLang(candidates, { prefer: g.lang });
}

function sortLangCodes(langs: string[]): string[] {
  const out = [...langs];
  out.sort((a, b) => {
    if (a === 'en') return -1;
    if (b === 'en') return 1;
    return a.localeCompare(b);
  });
  return out;
}

/** Union of IFO menu language units across domains in converted metadata. */
export function listDiscMenuLanguages(metadata: DiscMetadata): string[] {
  const seen = new Set<string>();
  for (const domain of metadata) {
    for (const lang of Object.keys(domain.menu || {})) {
      if (lang && !/^\d+$/.test(lang)) {
        seen.add(normalizeMenuLangCode(lang));
      }
    }
  }
  return sortLangCodes([...seen]);
}

/** Human label for an ISO-639 menu lang code. */
export function menuLangLabel(code: string): string {
  const lang = normalizeMenuLangCode(code);
  if (lang === UNSPECIFIED_MENU_LANG) {
    return 'Default';
  }
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(lang);
      if (name && name.toLowerCase() !== lang) {
        return `${name} (${lang})`;
      }
    }
  } catch {
    // fall through
  }
  return lang.toUpperCase();
}

/** Pack ISO-639-2/T alpha-2/3 into DVD SPRM 16-bit code (e.g. "en" → 0x656E). */
export function packMenuLangSprm(lang: string): number {
  const a = normalizeMenuLangCode(lang);
  if (a === UNSPECIFIED_MENU_LANG) {
    return 0xffff;
  }
  const c0 = a.charCodeAt(0) || 0x65;
  const c1 = a.charCodeAt(1) || 0x6e;
  return ((c0 & 0xff) << 8) | (c1 & 0xff);
}

export type SetMenuLanguageHost = {
  goToMainMenu?: () => boolean;
  onmenu?: ((event: object) => void) | null;
};

function listAllVmMenuLangs(g: VmLangGlobals): string[] {
  const seen = new Set<string>();
  const tables = [g.MPGCIUT, g.MENU_TYPES];
  for (const table of tables) {
    if (!Array.isArray(table)) continue;
    for (const entry of table) {
      for (const lang of menuLangKeys(entry)) {
        seen.add(lang);
      }
    }
  }
  return [...seen];
}

/**
 * Persist preference, update VM globals, and jump to the main menu in that LU.
 */
export function setDiscMenuLanguage(
  host: SetMenuLanguageHost,
  lang: string,
  g: VmLangGlobals = typeof window !== 'undefined' ? (window as any) : {},
): boolean {
  aliasUnspecifiedMenuLangs(g);
  const code = normalizeMenuLangCode((lang || '').trim().toLowerCase());
  if (!code) {
    return false;
  }
  const available = listAllVmMenuLangs(g).map(normalizeMenuLangCode);
  if (available.length && !available.includes(code)) {
    return false;
  }

  setStoredMenuLang(code);
  g.lang = code;
  if (g.sprm && typeof g.sprm === 'object') {
    g.sprm.MENU_LANG = packMenuLangSprm(code);
  }

  if (typeof host.goToMainMenu !== 'function') {
    return false;
  }
  return host.goToMainMenu();
}

/** Current VM menu lang (after init), else resolved default from metadata. */
export function currentOrDefaultMenuLang(
  metadata: DiscMetadata,
  g: VmLangGlobals = typeof window !== 'undefined' ? (window as any) : {},
): string {
  const fromMeta = listDiscMenuLanguages(metadata);
  const fromVm = listAllVmMenuLangs(g);
  const candidates = fromVm.length ? fromVm : fromMeta;
  return resolveMenuLang(candidates, { prefer: g.lang });
}

/**
 * Rename legacy "ÿÿ" LU keys to "default" on a loaded vm.js (older archives).
 * Also rewrites MENU_TYPES[].lang string fields.
 */
export function aliasUnspecifiedMenuLangs(g: VmLangGlobals): void {
  const tables = [g.MPGCIUT, g.MENU_TYPES];
  for (const table of tables) {
    if (!Array.isArray(table)) continue;
    for (const entry of table) {
      if (!entry || typeof entry !== 'object') continue;
      const rec = entry as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(rec, 'ÿÿ')) {
        if (!Object.prototype.hasOwnProperty.call(rec, UNSPECIFIED_MENU_LANG)) {
          rec[UNSPECIFIED_MENU_LANG] = rec['ÿÿ'];
        }
        delete rec['ÿÿ'];
      }
      for (const lang of Object.keys(rec)) {
        if (/^\d+$/.test(lang)) continue;
        const bucket = rec[lang];
        if (!Array.isArray(bucket)) continue;
        for (const slot of bucket) {
          if (
            slot &&
            typeof slot === 'object' &&
            typeof (slot as { lang?: string }).lang === 'string'
          ) {
            (slot as { lang: string }).lang = normalizeMenuLangCode(
              (slot as { lang: string }).lang,
            );
          }
        }
      }
    }
  }
  if (g.lang) {
    g.lang = normalizeMenuLangCode(g.lang);
  }
}
