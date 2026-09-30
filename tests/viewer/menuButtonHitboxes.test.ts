import { describe, expect, it, vi } from 'vitest';
import {
  applyMenuButtonGeometry,
  stampHitboxStylesFromStylesheet,
} from '../../viewer/src/host/menuButtonHitboxes.js';

function fakeEl(tag = 'div') {
  const styleProps: Record<string, string> = {};
  const style = {
    getPropertyValue(prop: string) {
      return styleProps[prop] || '';
    },
    setProperty(prop: string, value: string) {
      styleProps[prop] = value;
      (style as Record<string, string>)[prop] = value;
    },
    left: '',
    top: '',
    width: '',
    height: '',
    color: '',
  } as CSSStyleDeclaration & Record<string, string>;
  // Keep style.left etc. in sync for assert convenience.
  for (const p of ['left', 'top', 'width', 'height', 'color'] as const) {
    Object.defineProperty(style, p, {
      configurable: true,
      get: () => styleProps[p] || '',
      set: (v: string) => {
        styleProps[p] = v;
      },
    });
  }

  const children: ReturnType<typeof fakeEl>[] = [];
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    dataset: {} as Record<string, string>,
    style,
    children,
    append(...nodes: ReturnType<typeof fakeEl>[]) {
      children.push(...nodes);
    },
    appendChild(node: ReturnType<typeof fakeEl>) {
      children.push(node);
      return node;
    },
    querySelector(sel: string) {
      const idMatch = sel.match(/data-id=["']?(\d+)["']?/);
      if (idMatch) {
        return (
          children.find((c) => c.dataset.id === idMatch[1]) || null
        );
      }
      return null;
    },
    addEventListener: vi.fn(),
  };
  return el;
}

describe('menuButtonHitboxes', () => {
  it('applyMenuButtonGeometry stamps css decls as inline styles', () => {
    const input = fakeEl('input');
    applyMenuButtonGeometry(input as unknown as HTMLElement, {
      css: 'left:17.2%;top:79.2%;width:12.2%;height:12.2%;',
    });
    expect(input.style.left).toBe('17.2%');
    expect(input.style.top).toBe('79.2%');
    expect(input.style.width).toBe('12.2%');
    expect(input.style.height).toBe('12.2%');
  });

  it('applyMenuButtonGeometry ignores adjacency left/right numbers (not CSS)', () => {
    const input = fakeEl('input');
    // PCI nav uses left/right as neighbor button ids — must not become left:1%.
    applyMenuButtonGeometry(input as unknown as HTMLElement, {
      left: 1,
      right: 2,
      up: 1,
      down: 2,
    } as { css?: string });
    expect(input.style.left).toBe('');
    expect(input.style.width).toBe('');
  });

  it('applyMenuButtonGeometry ignores non-geometry decls in css', () => {
    const input = fakeEl('input');
    applyMenuButtonGeometry(input as unknown as HTMLElement, {
      css: 'left:10%;color:red;width:20%;',
    });
    expect(input.style.left).toBe('10%');
    expect(input.style.width).toBe('20%');
    expect(input.style.color).toBe('');
  });

  it('stampHitboxStylesFromStylesheet copies sheet geometry even when selectors mismatch', () => {
    const menu = fakeEl('div');
    menu.dataset.domain = '1';
    menu.dataset.cell = '1';
    menu.dataset.vob = '999'; // mismatch vs sheet selector below
    const btn0 = fakeEl('input');
    btn0.className = 'btn';
    btn0.dataset.id = '0';
    const btn1 = fakeEl('input');
    btn1.className = 'btn';
    btn1.dataset.id = '1';
    menu.append(btn0, btn1);

    const link = fakeEl('link') as ReturnType<typeof fakeEl> & {
      sheet?: { cssRules: unknown[] };
      rel?: string;
    };
    link.rel = 'stylesheet';
    link.sheet = {
      cssRules: [
        {
          selectorText:
            '[data-domain="1"][data-cell="2"][data-vob="1"] .btn[data-id="0"]',
          style: { left: '10%', top: '20%', width: '30%', height: '15%' },
        },
        {
          selectorText:
            '[data-domain="1"][data-cell="2"][data-vob="1"] .btn[data-id="1"]',
          style: { left: '40%', top: '50%', width: '25%', height: '12%' },
        },
      ],
    };

    stampHitboxStylesFromStylesheet(
      menu as unknown as ParentNode,
      link as unknown as HTMLLinkElement,
    );

    expect(btn0.style.left).toBe('10%');
    expect(btn0.style.top).toBe('20%');
    expect(btn0.style.width).toBe('30%');
    expect(btn0.style.height).toBe('15%');
    expect(btn1.style.left).toBe('40%');
    expect(btn1.style.width).toBe('25%');
  });

  it('stampHitboxStylesFromStylesheet does not overwrite existing inline geometry', () => {
    const menu = fakeEl('div');
    const btn = fakeEl('input');
    btn.className = 'btn';
    btn.dataset.id = '0';
    btn.style.left = '1%';
    menu.appendChild(btn);

    const link = {
      sheet: {
        cssRules: [
          {
            selectorText: '.btn[data-id="0"]',
            style: { left: '99%', top: '50%', width: '10%', height: '10%' },
          },
        ],
      },
      addEventListener: vi.fn(),
    };

    stampHitboxStylesFromStylesheet(
      menu as unknown as ParentNode,
      link as unknown as HTMLLinkElement,
    );
    expect(btn.style.left).toBe('1%');
    expect(btn.style.top).toBe('50%');
  });

  it('stampHitboxStylesFromStylesheet waits for link load when sheet is missing', () => {
    const menu = fakeEl('div');
    const btn = fakeEl('input');
    btn.className = 'btn';
    btn.dataset.id = '0';
    menu.appendChild(btn);

    const link = {
      sheet: null as CSSStyleSheet | null,
      addEventListener: vi.fn(),
    };
    stampHitboxStylesFromStylesheet(
      menu as unknown as ParentNode,
      link as unknown as HTMLLinkElement,
    );
    expect(link.addEventListener).toHaveBeenCalledWith(
      'load',
      expect.any(Function),
      { once: true },
    );
  });
});
