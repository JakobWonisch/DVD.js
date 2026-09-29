import { menuLangKeys, pickMenuLang } from '../host/titleUnavailable.js';
import { patchPlayCurrentMenuCellPgN } from './patchMenuPgN.js';

type VmGlobals = {
  init?: () => void;
  fp_pgc?: () => void;
  lang?: string;
  domain?: number;
  playCurrentMenuCell?: (...args: unknown[]) => unknown;
  MPGCIUT?: Array<Record<string, unknown> | undefined>;
  MENU_TYPES?: Array<Record<string, Array<{ domain: number; lang: string; pgc: number } | undefined>> | undefined>;
};

function pickExistingLang(host: HTMLElement) {
  const g = window as unknown as VmGlobals;
  if (typeof g.MPGCIUT === 'undefined' || !Array.isArray(g.MPGCIUT)) {
    return;
  }
  // Prefer a lang that exists on VMGM (domain 0). Iterating every domain used
  // to let a later VTS overwrite g.lang with a code missing from MPGCIUT[0],
  // which breaks JumpSS VMGM (MPGCIUT[0][lang] is undefined).
  g.lang = pickMenuLang(g as any, 0);
  if (!menuLangKeys(g.MPGCIUT[0]).length) {
    for (let d = 1; d < g.MPGCIUT.length; d++) {
      const keys = menuLangKeys(g.MPGCIUT[d]);
      if (keys.length) {
        g.lang = keys[0];
        break;
      }
    }
  }

  // Harden onmenu: prefer a non-stub Root, else VMGM Title.
  // Avatar VTS5 Root is empty and JumpTTs into missing titles — skip stubs.
  // Harry Potter has no VMGM Title (MENU_TYPES[0] empty/`ÿÿ`) — search every
  // domain for a real Root so Main menu / dismiss never leaves UI dead.
  const dvd = host as HTMLElement & { onmenu?: (event: object) => void };
  dvd.onmenu = () => {
    const domain = g.domain ?? 0;
    const isStub = (
      m: { domain: number; lang: string; pgc: number } | null | undefined,
    ) => {
      if (!m || !g.MPGCIUT?.[m.domain]) {
        return true;
      }
      const pgcObj = (g.MPGCIUT[m.domain] as any)?.[m.lang]?.[m.pgc];
      return (
        !pgcObj || !Array.isArray(pgcObj.cells) || pgcObj.cells.length === 0
      );
    };

    const run = (
      m: { domain: number; lang: string; pgc: number } | null | undefined,
    ) => {
      if (
        !m ||
        !g.MPGCIUT?.[m.domain] ||
        typeof (g.MPGCIUT[m.domain] as any)?.[m.lang]?.[m.pgc]?.run !==
          'function'
      ) {
        return false;
      }
      g.domain = m.domain;
      g.lang = m.lang;
      (g.MPGCIUT[m.domain] as any)[m.lang][m.pgc].run();
      return true;
    };

    const domainLang = pickMenuLang(g as any, domain);
    const vmgmLang = pickMenuLang(g as any, 0);
    const domainMenus =
      g.MENU_TYPES &&
      g.MENU_TYPES[domain] &&
      g.MENU_TYPES[domain]![domainLang];
    const vmgmMenus =
      g.MENU_TYPES && g.MENU_TYPES[0] && g.MENU_TYPES[0]![vmgmLang];

    if (domainMenus?.[3] && !isStub(domainMenus[3]!) && run(domainMenus[3]!)) {
      return;
    }
    if (vmgmMenus?.[2] && run(vmgmMenus[2]!)) {
      return;
    }

    if (g.MENU_TYPES) {
      for (let d = 0; d < g.MENU_TYPES.length; d++) {
        const byLang = g.MENU_TYPES[d];
        if (!byLang) continue;
        for (const L of menuLangKeys(byLang)) {
          const root = byLang[L]?.[3];
          if (root && !isStub(root) && run(root)) {
            return;
          }
        }
      }
      for (let d = 0; d < g.MENU_TYPES.length; d++) {
        const byLang = g.MENU_TYPES[d];
        if (!byLang) continue;
        for (const L of menuLangKeys(byLang)) {
          const title = byLang[L]?.[2];
          if (title && run(title)) {
            return;
          }
        }
      }
    }

    if (domainMenus?.[3]) {
      run(domainMenus[3]!);
    }
  };
}

/** Harmless stand-in so leaked vm.js handlers never see a deleted `dvd` binding. */
function dvdStub(): object {
  return {
    addEventListener() {},
    removeEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

function unbindVmKeyHandler(host: HTMLElement) {
  const handler = (host as any)._dvdjsKeyHandler;
  if (typeof handler === 'function') {
    document.removeEventListener('keydown', handler);
  }
  delete (host as any)._dvdjsKeyHandler;
}

/**
 * Load a converted disc's vm.js and bind window.dvd.
 * Does not start FP_PGC — call {@link startVm} after a user gesture (Start).
 * Returns a disposer that removes the script tag.
 */
export function loadVm(
  dvdId: string,
  host: HTMLElement,
): Promise<() => void> {
  return new Promise((resolve, reject) => {
    // Bind before script eval — vm.js uses bare `dvd` (not window.dvd).
    (window as any).dvd = host;

    const script = document.createElement('script');
    // Cache-bust so revisiting a disc re-executes vm.js (fresh globals / init).
    script.src = `/${dvdId}/vm.js?t=${Date.now()}`;
    script.async = false;

    const dispose = () => {
      unbindVmKeyHandler(host);
      script.remove();
      delete (host as any)._dvdjsVmInited;
      if ((window as any).dvd === host) {
        // Never `delete window.dvd`: after delete, bare `dvd` in vm.js throws
        // ReferenceError (seen on re-init / leftover keydown after a prior disc).
        (window as any).dvd = dvdStub();
      }
    };

    script.onload = () => {
      console.log('DVD vm.js loaded.');
      (window as any).dvd = host;
      // Allow a fresh init() if this host was used for a previous disc.
      delete (host as any)._dvdjsVmInited;
      unbindVmKeyHandler(host);

      const g = window as unknown as VmGlobals;
      patchPlayCurrentMenuCellPgN(g as unknown as Record<string, unknown>);
      if (typeof g.init === 'function') {
        g.init();
        // Mark even when older vm.js has no idempotent guard, so startVm
        // does not stack a second click/keydown listener.
        (host as any)._dvdjsVmInited = true;
      }
      pickExistingLang(host);
      resolve(dispose);
    };
    script.onerror = () => {
      dispose();
      reject(new Error(`Failed to load /${dvdId}/vm.js`));
    };

    document.head.appendChild(script);
  });
}

/** Run First-Play (intro) from the beginning. Call from a user gesture when possible. */
export function startVm(host: HTMLElement) {
  (window as any).dvd = host;
  const g = window as unknown as VmGlobals;
  // Fresh FP — allow missing-title auto-skip again after a prior cycle break.
  (host as any)._dvdjsMissingTitleBroken = false;
  if ((host as any)._dvdjsMissingTitleSkip) {
    (host as any)._dvdjsMissingTitleSkip.clear();
  }
  // init() is already run from loadVm. Older vm.js is not idempotent — calling
  // it again stacked click handlers so the second saw parentNode === null after
  // the first btnCmd rebuilt the menu (Harry Potter Special Features B0).
  if (typeof g.init === 'function' && !(host as any)._dvdjsVmInited) {
    g.init();
    (host as any)._dvdjsVmInited = true;
  }
  pickExistingLang(host);
  if (typeof g.fp_pgc === 'function') {
    console.log('Start the DVD.');
    g.fp_pgc();
  }
}

/**
 * @deprecated Prefer loadVm + startVm so playback begins after a user gesture.
 */
export function loadAndStartVm(
  dvdId: string,
  host: HTMLElement,
): Promise<() => void> {
  return loadVm(dvdId, host).then((dispose) => {
    startVm(host);
    return dispose;
  });
}
