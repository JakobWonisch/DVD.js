/**
 * Menus-mode title stubs: skipped PGCs (silent post) and interactive stills
 * with end-of-title buttons when feature WebMs were omitted.
 */

import {
  clearUserButtonNav,
  tryAutoSkipMissingTitle,
  type MissingTitleSkipHost,
  type VmNavGlobals,
} from './titleUnavailable.js';

export type TitleStubButton = {
  id?: number;
  up?: number;
  down?: number;
  left?: number;
  right?: number;
  auto_action_mode?: number;
  css?: string;
};

export type TitleStubEntry = {
  kind: 'interactive' | 'skip';
  cellID?: number;
  vobID?: number;
  still?: string | null;
  css?: string | null;
  still_time?: number;
  buttons?: TitleStubButton[];
  btn_nb?: number;
};

export type TitlePgcMediaWithStubs = {
  includedPgcs?: number[];
  pgcTimeline?: Record<string, { startSec: number; endSec: number }>;
  stubs?: Record<string, TitleStubEntry>;
};

export function getTitleStub(
  media: TitlePgcMediaWithStubs | null | undefined,
  pgc: number | undefined,
): TitleStubEntry | null {
  if (!media || !media.stubs || pgc == null || !Number.isFinite(pgc)) {
    return null;
  }
  const stub = media.stubs[String(pgc)];
  return stub && (stub.kind === 'interactive' || stub.kind === 'skip')
    ? stub
    : null;
}

/**
 * Silent advance for buttonless omitted titles (and FP paths).
 * Returns true when the caller should not show the unavailable dialog.
 */
export function playSkipTitleStub(
  host: MissingTitleSkipHost,
  g: VmNavGlobals = typeof window !== 'undefined' ? (window as any) : {},
): boolean {
  clearUserButtonNav(host);
  // Force non-button path so tryAutoSkip always posts (even after menu JumpTT).
  return tryAutoSkipMissingTitle(host, g, false);
}

export const TITLE_STUB_BANNER =
  'Feature not included — choose an option';

/**
 * Ensure a synthetic x-menu exists for an interactive title stub and install
 * still + buttons. Returns the menu element.
 */
export function ensureTitleStubMenu(
  host: HTMLElement,
  domain: number,
  stub: TitleStubEntry,
): HTMLElement {
  const id = `title-stub-${domain}`;
  let menu = host.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
  if (!menu) {
    menu = document.createElement('x-menu') as HTMLElement;
    menu.id = id;
    menu.classList.add('dvdjs-title-stub');
    host.appendChild(menu);
  }

  menu.dataset.domain = String(domain);
  if (stub.cellID != null) {
    menu.dataset.cell = String(stub.cellID);
  }
  if (stub.vobID != null) {
    menu.dataset.vob = String(stub.vobID);
  }
  menu.dataset.stillTime = String(
    stub.still_time != null ? stub.still_time : 255,
  );

  // Still image
  let still = menu.querySelector('img.menu-still') as HTMLImageElement | null;
  if (!still) {
    still = document.createElement('img');
    still.className = 'menu-still';
    still.alt = '';
    still.setAttribute('aria-hidden', 'true');
    menu.appendChild(still);
  }
  if (stub.still) {
    still.src = stub.still;
    still.hidden = false;
    still.style.opacity = '1';
  }

  // Quiet banner
  let banner = menu.querySelector(
    '.dvdjs-title-stub__banner',
  ) as HTMLElement | null;
  if (!banner) {
    banner = document.createElement('p');
    banner.className = 'dvdjs-title-stub__banner';
    menu.appendChild(banner);
  }
  banner.textContent = TITLE_STUB_BANNER;

  // Replace buttons
  menu.querySelectorAll('input.btn').forEach((el) => el.remove());
  const buttons = stub.buttons || [];
  for (let i = 0; i < buttons.length; i++) {
    const nav = buttons[i] || {};
    const btn = document.createElement('input');
    btn.type = 'button';
    btn.className = 'btn';
    btn.dataset.id = String(nav.id != null ? nav.id : i);
    if (nav.up != null) btn.dataset.up = String(nav.up);
    if (nav.down != null) btn.dataset.down = String(nav.down);
    if (nav.left != null) btn.dataset.left = String(nav.left);
    if (nav.right != null) btn.dataset.right = String(nav.right);
    if (nav.auto_action_mode) {
      btn.dataset.autoAction = String(nav.auto_action_mode);
    }
    if (nav.css) {
      btn.setAttribute('style', nav.css);
    }
    menu.appendChild(btn);
  }

  // Linked stylesheet for older archives / fallback selectors
  if (stub.css) {
    const linkId = `title-stub-css-${domain}-${stub.cellID}-${stub.vobID}`;
    let link = document.getElementById(linkId) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.href = stub.css;
      document.head.appendChild(link);
    } else if (link.href !== stub.css && !link.href.endsWith(stub.css)) {
      link.href = stub.css;
    }
  }

  return menu;
}
