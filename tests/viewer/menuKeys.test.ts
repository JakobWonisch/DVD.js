import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateButton,
  bindMenuKeys,
  findSpatialNeighbor,
  handleMenuKeyDown,
  handleMenuNavAction,
  lookupBtnCmd,
  type MenuKeyHost,
} from '../../viewer/src/host/menuKeys.ts';

function fakeButton(top: number, left = 100): HTMLInputElement {
  const btn = {
    getBoundingClientRect: () => ({
      left,
      top,
      width: 200,
      height: 40,
      right: left + 200,
      bottom: top + 40,
      x: left,
      y: top,
      toJSON() {
        return {};
      },
    }),
  } as unknown as HTMLInputElement;
  return btn;
}

describe('findSpatialNeighbor', () => {
  const buttons = [
    fakeButton(100),
    fakeButton(160),
    fakeButton(220),
    fakeButton(280),
  ];

  it('walks down a vertical stack', () => {
    expect(findSpatialNeighbor(buttons, 0, 'down')).toBe(1);
    expect(findSpatialNeighbor(buttons, 1, 'down')).toBe(2);
    expect(findSpatialNeighbor(buttons, 2, 'down')).toBe(3);
    expect(findSpatialNeighbor(buttons, 3, 'down')).toBe(null);
  });

  it('walks up a vertical stack', () => {
    expect(findSpatialNeighbor(buttons, 3, 'up')).toBe(2);
    expect(findSpatialNeighbor(buttons, 0, 'up')).toBe(null);
  });
});

describe('lookupBtnCmd', () => {
  it('keeps separate button sets for the same vob across cells', () => {
    // Harry Potter Special Features: cell1/vob5 has Main Menu at btn 3;
    // a later cell with the same vob_id has only 2 buttons.
    const mainMenu = () => 'main';
    const other = () => 'other';
    const btnCmd: any = [];
    btnCmd[1] = [];
    btnCmd[1][5] = [];
    btnCmd[1][5][1] = [() => 'a', () => 'b', () => 'c', mainMenu];
    btnCmd[1][5][4] = [other, () => 'x'];

    expect(lookupBtnCmd(btnCmd, '1', '5', '1', 3)).toBe(mainMenu);
    expect(lookupBtnCmd(btnCmd, '1', '5', '4', 0)).toBe(other);
    expect(lookupBtnCmd(btnCmd, '1', '5', '4', 3)).toBeUndefined();
    // Legacy vob-only shape must not accidentally return a cell array.
    expect(lookupBtnCmd(btnCmd, '1', '5', '1', 1)).not.toBe(btnCmd[1][5][1]);
  });
});

/** Minimal menu tree for node env (no happy-dom). */
function fakeMenuHost(cell: string | null = '1') {
  const buttons = [0, 1, 2, 3].map((i) => {
    const classNames = new Set(['btn']);
    return {
      tagName: 'INPUT',
      classList: {
        contains: (c: string) => classNames.has(c),
        add: (c: string) => classNames.add(c),
        remove: (c: string) => classNames.delete(c),
      },
      dataset: { id: String(i), selected: i === 0 ? '1' : undefined } as Record<
        string,
        string | undefined
      >,
      disabled: false,
    };
  });
  const menu: any = {
    hidden: false,
    style: { display: 'flex' },
    dataset: {
      domain: '1',
      vob: '5',
      ...(cell != null ? { cell } : {}),
    },
    querySelectorAll: (sel: string) =>
      sel === 'input.btn' ? buttons : [],
  };
  const host = {
    _dvdjsActiveMenu: menu,
    _dvdjsFromButton: false,
    setMenuHighlight: vi.fn(),
    flashMenuActivate: vi.fn(),
  } as unknown as MenuKeyHost;
  return { host, menu, buttons };
}

function fakeKey(key: string, code = key) {
  let prevented = false;
  return {
    key,
    code,
    target: null,
    preventDefault() {
      prevented = true;
    },
    get defaultPrevented() {
      return prevented;
    },
  } as unknown as KeyboardEvent;
}

describe('Enter activates via cell-keyed btnCmd', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubWindow(partial: Record<string, unknown>) {
    class FakeHTMLElement {}
    class FakeHTMLInputElement extends FakeHTMLElement {}
    vi.stubGlobal('HTMLElement', FakeHTMLElement);
    vi.stubGlobal('HTMLInputElement', FakeHTMLInputElement);
    vi.stubGlobal('window', partial);
  }

  it('activateButton runs btnCmd[domain][vob][cell][idx]', () => {
    const { host, menu } = fakeMenuHost('1');
    const mainMenu = vi.fn();
    const btnCmd: any = [];
    btnCmd[1] = [];
    btnCmd[1][5] = [];
    btnCmd[1][5][1] = [vi.fn(), vi.fn(), vi.fn(), mainMenu];
    const sprm = { HL_BTNN: 1 * 0x0400 };
    stubWindow({ btnCmd, sprm });

    expect(activateButton(host, menu, 3)).toBe(true);
    expect(mainMenu).toHaveBeenCalledOnce();
    expect(host._dvdjsFromButton).toBe(true);
    expect(host.setMenuHighlight).toHaveBeenCalledWith(menu, 3);
    expect(sprm.HL_BTNN).toBe(4 * 0x0400);
  });

  it('Enter claims the key only when a command runs', () => {
    const { host, menu } = fakeMenuHost('1');
    const cmd0 = vi.fn();
    const btnCmd: any = [];
    btnCmd[1] = [];
    btnCmd[1][5] = [];
    btnCmd[1][5][1] = [cmd0];
    stubWindow({ btnCmd, sprm: { HL_BTNN: 1 * 0x0400 } });

    const ok = fakeKey('Enter');
    expect(handleMenuKeyDown(host, ok)).toBe(true);
    expect(ok.defaultPrevented).toBe(true);
    expect(cmd0).toHaveBeenCalledOnce();

    // Missing cell must not swallow Enter (vm.js still handles it).
    delete menu.dataset.cell;
    const miss = fakeKey('Enter');
    expect(handleMenuKeyDown(host, miss)).toBe(false);
    expect(miss.defaultPrevented).toBe(false);
  });

  it('handleMenuNavAction mirrors keyboard Enter / arrows', () => {
    const { host, menu, buttons } = fakeMenuHost('1');
    buttons[0].dataset.down = '2';
    buttons[1].dataset.up = '1';
    const cmd1 = vi.fn();
    const btnCmd: any = [];
    btnCmd[1] = [];
    btnCmd[1][5] = [];
    btnCmd[1][5][1] = [vi.fn(), cmd1];
    const sprm = { HL_BTNN: 1 * 0x0400 };
    stubWindow({ btnCmd, sprm });

    expect(handleMenuNavAction(host, 'down')).toBe(true);
    expect(sprm.HL_BTNN).toBe(2 * 0x0400);
    expect(host.setMenuHighlight).toHaveBeenCalledWith(menu, 1);

    expect(handleMenuNavAction(host, 'enter')).toBe(true);
    expect(cmd1).toHaveBeenCalledOnce();
  });
});

describe('bindMenuKeys click vs vm.js', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stops ImmediatePropagation after a successful button click', () => {
    class FakeHTMLElement {}
    class FakeHTMLInputElement extends FakeHTMLElement {}
    vi.stubGlobal('HTMLElement', FakeHTMLElement);
    vi.stubGlobal('HTMLInputElement', FakeHTMLInputElement);
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const cmd0 = vi.fn();
    const btnCmd: any = [];
    btnCmd[1] = [];
    btnCmd[1][5] = [];
    btnCmd[1][5][1] = [cmd0];
    vi.stubGlobal('window', { btnCmd, sprm: { HL_BTNN: 0x0400 } });

    const btn = Object.assign(new FakeHTMLInputElement(), {
      tagName: 'INPUT',
      classList: { contains: (c: string) => c === 'btn' },
      dataset: { id: '0' },
      disabled: false,
    });
    const menu: any = {
      hidden: false,
      style: { display: 'flex' },
      dataset: { domain: '1', vob: '5', cell: '1' },
      contains: (n: unknown) => n === btn,
      querySelectorAll: () => [btn],
    };

    let onClick: ((e: MouseEvent) => void) | undefined;
    const host = {
      _dvdjsActiveMenu: menu,
      addEventListener(type: string, fn: (e: MouseEvent) => void) {
        if (type === 'click') onClick = fn;
      },
      removeEventListener() {},
      setMenuHighlight: vi.fn(),
      flashMenuActivate: vi.fn(),
      beginUserButtonNav: vi.fn(),
    } as unknown as MenuKeyHost;

    const unbind = bindMenuKeys(host);
    expect(onClick).toBeTypeOf('function');

    let stopped = false;
    const event = {
      target: btn,
      preventDefault: vi.fn(),
      stopImmediatePropagation() {
        stopped = true;
      },
    } as unknown as MouseEvent;

    onClick!(event);
    expect(cmd0).toHaveBeenCalledOnce();
    expect(stopped).toBe(true);
    unbind();
  });
});
