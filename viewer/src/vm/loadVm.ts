type VmGlobals = {
  init?: () => void;
  fp_pgc?: () => void;
  lang?: string;
  domain?: number;
  MPGCIUT?: Array<Record<string, unknown> | undefined>;
  MENU_TYPES?: Array<Record<string, Array<{ domain: number; lang: string; pgc: number } | undefined>> | undefined>;
};

function pickExistingLang(host: HTMLElement) {
  const g = window as unknown as VmGlobals;
  if (typeof g.MPGCIUT === 'undefined' || !Array.isArray(g.MPGCIUT)) {
    return;
  }
  g.MPGCIUT.forEach((obj) => {
    if (!obj) {
      return;
    }
    const keys = Object.keys(obj).filter((k) => !/^\d+$/.test(k));
    if (keys.length && typeof g.lang !== 'undefined' && keys.indexOf(g.lang) === -1) {
      g.lang = keys[0];
    }
  });

  // Harden onmenu for domains without MENU_TYPES (common after JumpTT).
  const dvd = host as HTMLElement & { onmenu?: (event: object) => void };
  dvd.onmenu = () => {
    let menu: { domain: number; lang: string; pgc: number } | null = null;
    const domainMenus =
      g.MENU_TYPES &&
      g.MENU_TYPES[g.domain ?? 0] &&
      g.MENU_TYPES[g.domain ?? 0]![g.lang ?? ''];
    const vmgmMenus =
      g.MENU_TYPES && g.MENU_TYPES[0] && g.MENU_TYPES[0]![g.lang ?? ''];
    if (domainMenus && domainMenus[3]) {
      menu = domainMenus[3]!;
    } else if (vmgmMenus && vmgmMenus[2]) {
      menu = vmgmMenus[2]!;
    }
    if (
      menu &&
      g.MPGCIUT &&
      g.MPGCIUT[menu.domain] &&
      (g.MPGCIUT[menu.domain] as any)[menu.lang]
    ) {
      (g.MPGCIUT[menu.domain] as any)[menu.lang][menu.pgc].run();
    }
  };
}

/**
 * Load a converted disc's vm.js, bind window.dvd, then start FP_PGC.
 * Returns a disposer that removes the script tag.
 */
export function loadAndStartVm(
  dvdId: string,
  host: HTMLElement,
): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `/${dvdId}/vm.js`;
    script.async = false;

    const dispose = () => {
      script.remove();
      if ((window as any).dvd === host) {
        delete (window as any).dvd;
      }
    };

    script.onload = () => {
      console.log('Start the DVD.');
      (window as any).dvd = host;

      const g = window as unknown as VmGlobals;
      if (typeof g.init === 'function') {
        g.init();
      }
      pickExistingLang(host);
      if (typeof g.fp_pgc === 'function') {
        g.fp_pgc();
      }
      resolve(dispose);
    };
    script.onerror = () => {
      dispose();
      reject(new Error(`Failed to load /${dvdId}/vm.js`));
    };

    document.head.appendChild(script);
  });
}
