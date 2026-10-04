import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MENU_LANG_STORAGE_KEY,
  UNSPECIFIED_MENU_LANG,
  aliasUnspecifiedMenuLangs,
  bridgeMenuLangBuckets,
  getStoredMenuLang,
  listDiscMenuLanguages,
  menuLangLabel,
  normalizeMenuLangCode,
  packMenuLangSprm,
  pickMenuLang,
  resolveMenuLang,
  setDiscMenuLanguage,
  setStoredMenuLang,
} from '../../viewer/src/host/menuLanguage.ts';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveMenuLang', () => {
  it('prefers last selected, then en, then first', () => {
    expect(
      resolveMenuLang(['de', 'fr', 'en'], { stored: 'fr', prefer: null }),
    ).toBe('fr');
    expect(
      resolveMenuLang(['de', 'fr', 'en'], { stored: 'ja', prefer: null }),
    ).toBe('en');
    expect(
      resolveMenuLang(['de', 'fr'], { stored: 'ja', prefer: null }),
    ).toBe('de');
  });

  it('keeps a valid session prefer over stored', () => {
    expect(
      resolveMenuLang(['de', 'en'], { prefer: 'de', stored: 'en' }),
    ).toBe('de');
  });
});

describe('pickMenuLang', () => {
  it('uses stored preference when current lang is missing', () => {
    const storage = memoryStorage({ [MENU_LANG_STORAGE_KEY]: 'de' });
    vi.stubGlobal('localStorage', storage);
    expect(
      pickMenuLang({
        lang: 'ja',
        MPGCIUT: [{ en: {}, de: {} }],
      }),
    ).toBe('de');
  });

  it('falls back to en then first', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    expect(
      pickMenuLang({
        MPGCIUT: [{ fr: {}, en: {} }],
      }),
    ).toBe('en');
    expect(
      pickMenuLang({
        MPGCIUT: [{ fr: {}, de: {} }],
      }),
    ).toBe('fr');
  });
});

describe('listDiscMenuLanguages', () => {
  it('unions langs across domains and sorts en first', () => {
    expect(
      listDiscMenuLanguages([
        { menu: { de: [], fr: [] } },
        { menu: { en: [], de: [] } },
      ]),
    ).toEqual(['en', 'de', 'fr']);
  });

  it('maps unspecified ÿÿ LU to default', () => {
    expect(
      listDiscMenuLanguages([
        { menu: { 'ÿÿ': [] } },
        { menu: { en: [], de: [], nl: [] } },
      ]),
    ).toEqual(['en', 'de', 'default', 'nl']);
    expect(normalizeMenuLangCode('ÿÿ')).toBe(UNSPECIFIED_MENU_LANG);
    expect(menuLangLabel('ÿÿ')).toBe('Default');
    expect(packMenuLangSprm('default')).toBe(0xffff);
  });
});

describe('aliasUnspecifiedMenuLangs', () => {
  it('renames ÿÿ buckets to default and rewrites MENU_TYPES lang', () => {
    const root = { domain: 0, lang: 'ÿÿ', pgc: 1 };
    const g: any = {
      lang: 'ÿÿ',
      MPGCIUT: [{ 'ÿÿ': { 1: {} } }],
      MENU_TYPES: [{ 'ÿÿ': [null, null, root] }],
    };
    aliasUnspecifiedMenuLangs(g);
    expect(g.MPGCIUT[0].default).toEqual({ 1: {} });
    expect(g.MPGCIUT[0]['ÿÿ']).toBeUndefined();
    expect(g.MENU_TYPES[0].default[2].lang).toBe('default');
    expect(g.lang).toBe('default');
  });
});

describe('bridgeMenuLangBuckets', () => {
  it('aliases VMGM default ↔ VTS ISO LUs (Thief Lord)', () => {
    const vmgm = { 1: { run: vi.fn() } };
    const vtsEn = {
      1: { cells: [{ still_time: 255 }], run: vi.fn() },
    };
    const rootEn = { domain: 1, lang: 'en', pgc: 1 };
    const g: any = {
      lang: 'default',
      MPGCIUT: [
        { default: vmgm },
        { en: vtsEn, nl: {}, de: {} },
      ],
      MENU_TYPES: [
        { default: [null, null, { domain: 0, lang: 'default', pgc: 1 }] },
        { en: [null, null, null, rootEn], nl: [], de: [] },
      ],
    };
    bridgeMenuLangBuckets(g);
    expect(g.MPGCIUT[0].en).toBe(vmgm);
    expect(g.MPGCIUT[1].default).toBe(vtsEn);
    expect(g.MENU_TYPES[1].default[3]).toBe(rootEn);
    // JumpSS-style access with either lang must resolve.
    expect(g.MENU_TYPES[1]['default'][3].lang).toBe('en');
    expect(g.MPGCIUT[0]['en']).toBeDefined();
  });
});

describe('setDiscMenuLanguage', () => {
  it('persists, updates sprm, and calls goToMainMenu', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const goToMainMenu = vi.fn(() => true);
    const g = {
      lang: 'en',
      sprm: { MENU_LANG: 0x656e },
      MPGCIUT: [{ en: {}, de: {} }],
    };
    expect(setDiscMenuLanguage({ goToMainMenu }, 'de', g)).toBe(true);
    expect(g.lang).toBe('de');
    expect(g.sprm.MENU_LANG).toBe(packMenuLangSprm('de'));
    expect(getStoredMenuLang(storage)).toBe('de');
    expect(goToMainMenu).toHaveBeenCalledOnce();
  });

  it('rejects langs not on the disc', () => {
    const goToMainMenu = vi.fn(() => true);
    const g = { MPGCIUT: [{ en: {} }] };
    expect(setDiscMenuLanguage({ goToMainMenu }, 'de', g)).toBe(false);
    expect(goToMainMenu).not.toHaveBeenCalled();
  });
});

describe('storage helpers', () => {
  it('round-trips stored menu lang', () => {
    const storage = memoryStorage();
    setStoredMenuLang('DE', storage);
    expect(getStoredMenuLang(storage)).toBe('de');
  });
});
