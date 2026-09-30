/**
 * Menu button hitboxes: geometry must not depend on [data-cell]/[data-vob]
 * matching the linked menu-*.css selectors. Those attrs are owned by the host
 * during multi-cell PGCs; if they drift (or the sheet loads late), percentage
 * rules never apply and every input.btn collapses to the top-left.
 *
 * Note: PCI `left`/`right`/`up`/`down` on button nav are neighbor ids — never
 * treat them as CSS percentages. Geometry lives only in `buttons[].css`.
 */

export type MenuButtonGeometry = {
  /** CSS decls from convert, e.g. "left:10%;top:20%;width:30%;height:10%;" */
  css?: string;
};

/** Apply left/top/width/height onto a hitbox (inline — selector-independent). */
export function applyMenuButtonGeometry(
  input: HTMLElement,
  nav: MenuButtonGeometry | null | undefined,
): void {
  if (!nav || typeof nav.css !== 'string' || !nav.css.trim()) {
    return;
  }
  applyCssDecls(input, nav.css);
}

/**
 * Copy geometry from the menu cell stylesheet onto buttons by data-id.
 * Works even when attribute selectors in the sheet do not match the live
 * data-cell/data-vob (cssRules still expose the declarations).
 */
export function stampHitboxStylesFromStylesheet(
  menu: ParentNode,
  link: HTMLLinkElement | null | undefined,
): void {
  if (!link) {
    return;
  }
  const run = () => {
    try {
      const sheet = link.sheet;
      if (!sheet) {
        return;
      }
      for (const rule of Array.from(sheet.cssRules)) {
        if (!isStyleRule(rule)) {
          continue;
        }
        const idMatch = rule.selectorText.match(
          /\.btn\[data-id=["']?(\d+)["']?\]/,
        );
        if (!idMatch) {
          continue;
        }
        const btn = menu.querySelector(
          `input.btn[data-id="${idMatch[1]}"]`,
        ) as HTMLElement | null;
        if (!btn) {
          continue;
        }
        // Prefer already-inlined convert geometry; fill gaps from the sheet.
        copyIfEmpty(btn, 'left', rule.style.left);
        copyIfEmpty(btn, 'top', rule.style.top);
        copyIfEmpty(btn, 'width', rule.style.width);
        copyIfEmpty(btn, 'height', rule.style.height);
      }
    } catch {
      // CSSOM can throw for opaque sheets; menu assets are same-origin.
    }
  };

  if (link.sheet) {
    run();
    return;
  }
  link.addEventListener('load', run, { once: true });
}

function applyCssDecls(el: HTMLElement, decls: string): void {
  for (const part of decls.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const colon = trimmed.indexOf(':');
    if (colon < 0) {
      continue;
    }
    const prop = trimmed.slice(0, colon).trim();
    const val = trimmed.slice(colon + 1).trim();
    if (
      prop === 'left' ||
      prop === 'top' ||
      prop === 'width' ||
      prop === 'height'
    ) {
      el.style.setProperty(prop, val);
    }
  }
}

function copyIfEmpty(el: HTMLElement, prop: string, value: string): void {
  if (!value) {
    return;
  }
  if (el.style.getPropertyValue(prop)) {
    return;
  }
  el.style.setProperty(prop, value);
}

function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
  return (
    (typeof CSSStyleRule !== 'undefined' && rule instanceof CSSStyleRule) ||
    ((rule as CSSStyleRule).style != null &&
      typeof (rule as CSSStyleRule).selectorText === 'string')
  );
}
