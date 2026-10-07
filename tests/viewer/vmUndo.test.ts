import { describe, expect, it } from 'vitest';
import {
  buildMenuResumeSnapshot,
  captureMenuResumeState,
  restoreMenuResumeState,
} from '../../viewer/src/host/titleUnavailable.js';
import {
  canVmUndo,
  clearVmUndo,
  estimateVmUndoBytes,
  pushVmUndo,
  restoreLastVmNav,
  undoVmNav,
  VM_UNDO_MAX,
  vmUndoDepth,
} from '../../viewer/src/host/vmUndo.js';

function makeHostAndG() {
  const menu: any = {
    id: 'menu-en-1-2',
    dataset: { domain: '1' },
    style: { display: 'flex' },
    hidden: false,
    show() {
      this.hidden = false;
      this.style.display = 'flex';
    },
  };
  const host: any = {
    _dvdjsActiveMenu: menu,
    setMenuHighlight: () => {},
    querySelector: (sel: string) => (sel === '#menu-en-1-2' ? menu : null),
  };
  const g: any = {
    domain: 1,
    pgc: 2,
    lang: 'en',
    pgcSpace: 'menu',
    cellN: 2,
    pgN: 2,
    gprm: Array.from({ length: 16 }, (_, i) => i),
    gprm_mode: Array(16).fill(0),
    sprm: { HL_BTNN: 3 * 0x0400, TTN: 1, MENU_LANG: 0x656e },
    rsm_cell: 0,
    rsm_vtsN: 0,
    rsm_pgcN: 0,
    rsm_regs: [0, 0, 0, 0, 0],
  };
  return { host, g, menu };
}

describe('vm undo stack', () => {
  it('captures full GPRM/SPRM and restores them on undo', () => {
    const { host, g } = makeHostAndG();
    pushVmUndo(host, g);

    g.domain = 4;
    g.pgc = 9;
    g.gprm[0x0b] = 42;
    g.sprm.HL_BTNN = 0x0400;
    g.cellN = 1;

    expect(canVmUndo(host)).toBe(true);
    expect(undoVmNav(host, g)).toBe(true);
    expect(g.domain).toBe(1);
    expect(g.pgc).toBe(2);
    expect(g.gprm[0x0b]).toBe(11);
    expect(g.sprm.HL_BTNN).toBe(3 * 0x0400);
    expect(g.cellN).toBe(2);
    expect(canVmUndo(host)).toBe(false);
  });

  it('caps stack at VM_UNDO_MAX', () => {
    const { host, g } = makeHostAndG();
    for (let i = 0; i < VM_UNDO_MAX + 10; i++) {
      g.cellN = i;
      pushVmUndo(host, g);
    }
    expect(vmUndoDepth(host)).toBe(VM_UNDO_MAX);
    // Oldest dropped — first remaining should be cellN = 10
    const topOldest = host._dvdjsVmUndo[0];
    expect(topOldest.cellN).toBe(10);
  });

  it('estimate stays small for a full stack', () => {
    const { host, g } = makeHostAndG();
    for (let i = 0; i < VM_UNDO_MAX; i++) {
      pushVmUndo(host, g);
    }
    const bytes = estimateVmUndoBytes(host);
    // Well under 1 MB; typical ~50–150 KB.
    expect(bytes).toBeLessThan(512_000);
    expect(bytes / VM_UNDO_MAX).toBeLessThan(8_000);
  });

  it('restoreLastVmNav prefers stack then menu resume latch', () => {
    const { host, g } = makeHostAndG();
    clearVmUndo(host);
    captureMenuResumeState(host, g);
    g.domain = 9;
    expect(restoreLastVmNav(host, g)).toBe(true);
    expect(g.domain).toBe(1);
    expect(host._dvdjsMenuResume).toBeNull();
  });

  it('buildMenuResumeSnapshot does not mutate live gprm', () => {
    const { host, g } = makeHostAndG();
    const snap = buildMenuResumeSnapshot(host, g);
    snap.gprm![0] = 999;
    expect(g.gprm[0]).toBe(0);
  });

  it('legacy resume restore still works with full snap', () => {
    const { host, g } = makeHostAndG();
    captureMenuResumeState(host, g);
    g.domain = 5;
    g.gprm[1] = 77;
    expect(restoreMenuResumeState(host, g)).toBe(true);
    expect(g.domain).toBe(1);
    expect(g.gprm[1]).toBe(1);
  });

  it('notifies on push / undo so the toolbar can enable', () => {
    const { host, g } = makeHostAndG();
    let changes = 0;
    host._dvdjsOnUndoChange = () => {
      changes += 1;
    };
    pushVmUndo(host, g);
    expect(changes).toBe(1);
    expect(canVmUndo(host)).toBe(true);
    undoVmNav(host, g);
    expect(changes).toBe(2);
    expect(canVmUndo(host)).toBe(false);
  });

  it('replays playCurrentMenuCell so still/buttons rebuild for the prior cell', () => {
    const { host, g } = makeHostAndG();
    const calls: Array<{ cellN: number; pgc: number; space: string }> = [];
    g.playCurrentMenuCell = () => {
      calls.push({
        cellN: g.cellN,
        pgc: g.pgc,
        space: g.pgcSpace,
      });
    };

    pushVmUndo(host, g);

    // Navigate to another cell in the same PGC (shared x-menu).
    g.cellN = 5;
    g.pgN = 5;
    g.pgc = 9;
    host._dvdjsActiveMenu.dataset.cell = '9';
    host._dvdjsActiveMenu.dataset.vob = '2';

    expect(undoVmNav(host, g)).toBe(true);
    expect(g.cellN).toBe(2);
    expect(g.pgc).toBe(2);
    expect(calls).toEqual([{ cellN: 2, pgc: 2, space: 'menu' }]);
  });

  it('restores the selected button (HL_BTNN) after replay', () => {
    const { host, g } = makeHostAndG();
    // Button 5 selected — typical “Next page” before LinkCN.
    g.sprm.HL_BTNN = 5 * 0x0400;
    const highlights: number[] = [];
    host.setMenuHighlight = (_menu: unknown, idx: number) => {
      highlights.push(idx);
    };
    g.playCurrentMenuCell = () => {
      // Destination page often forces button 1 — must not stick after undo.
      g.sprm.HL_BTNN = 1 * 0x0400;
    };

    pushVmUndo(host, g);
    g.cellN = 3;
    g.sprm.HL_BTNN = 1 * 0x0400;

    expect(undoVmNav(host, g)).toBe(true);
    expect(g.sprm.HL_BTNN).toBe(5 * 0x0400);
    expect(highlights.length).toBeGreaterThan(0);
    expect(highlights[highlights.length - 1]).toBe(4);
  });

  it('replays playCurrentTitleCell when undoing back into title space', () => {
    const { host, g } = makeHostAndG();
    g.pgcSpace = 'title';
    g.domain = 4;
    g.pgc = 1;
    g.cellN = 1;
    const titleCalls: number[] = [];
    const menuCalls: number[] = [];
    g.playCurrentTitleCell = () => {
      titleCalls.push(g.domain);
    };
    g.playCurrentMenuCell = () => {
      menuCalls.push(g.domain);
    };

    const titleVideo = {
      style: { display: 'block' },
      hidden: false,
      pause() {},
    };
    host.querySelectorAll = (sel: string) =>
      sel === 'video[id^="video-"]' ? [titleVideo] : [];

    pushVmUndo(host, g);

    // Jump to a menu (e.g. Main menu) — titles would normally be hidden.
    g.pgcSpace = 'menu';
    g.domain = 0;
    g.pgc = 1;

    expect(undoVmNav(host, g)).toBe(true);
    expect(g.pgcSpace).toBe('title');
    expect(g.domain).toBe(4);
    expect(titleCalls).toEqual([4]);
    expect(menuCalls).toEqual([]);
    // Must not hide title videos before title replay.
    expect(titleVideo.hidden).toBe(false);
    expect(titleVideo.style.display).toBe('block');
  });
});
