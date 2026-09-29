/**
 * Menu cell_cmds must run at cell end (onPost), indexed by cell_cmd_nr —
 * not dumped into one cell() called at PGC start (skips shared transitions).
 */
import { describe, expect, it, vi } from 'vitest';

describe('menu cellCmds onPost contract', () => {
  it('runs cellCmds[cell_cmd_nr-1] before advancing; return 1 stops', () => {
    const plays: number[] = [];
    let cellN = 1;
    let pgN = 1;
    const cellCmds = [
      vi.fn(() => {
        cellN = 2;
        pgN = 2;
        plays.push(2);
        return 1;
      }),
    ];
    const cells = [
      { cell_cmd_nr: 1, cellID: 1, vobID: 2 },
      { cell_cmd_nr: 0, cellID: 1, vobID: 4 },
    ];
    const cell = cells[0];
    const menu = { cellCmds, post: vi.fn() };

    // Mirrors playCurrentMenuCell onPost in generateJavaScript.ts
    const onPost = () => {
      const cmdNr = cell.cell_cmd_nr || 0;
      if (cmdNr && menu.cellCmds && typeof menu.cellCmds[cmdNr - 1] === 'function') {
        if (menu.cellCmds[cmdNr - 1]()) {
          return;
        }
      }
      if ((cellN || 1) < cells.length) {
        cellN = (cellN || 1) + 1;
        pgN = cellN;
        plays.push(cellN);
        return;
      }
      if (menu.post) {
        menu.post();
      }
    };

    onPost();
    expect(cellCmds[0]).toHaveBeenCalledOnce();
    expect(plays).toEqual([2]);
    expect(cellN).toBe(2);
    expect(pgN).toBe(2);
    expect(menu.post).not.toHaveBeenCalled();
  });

  it('advances when cell_cmd_nr is 0', () => {
    const plays: number[] = [];
    let cellN = 1;
    let pgN = 1;
    const cellCmds = [vi.fn(() => 1)];
    const cells = [
      { cell_cmd_nr: 0, cellID: 1, vobID: 1 },
      { cell_cmd_nr: 0, cellID: 2, vobID: 1 },
    ];
    const cell = cells[0];
    const menu = { cellCmds, post: vi.fn() };

    const onPost = () => {
      const cmdNr = cell.cell_cmd_nr || 0;
      if (cmdNr && menu.cellCmds && typeof menu.cellCmds[cmdNr - 1] === 'function') {
        if (menu.cellCmds[cmdNr - 1]()) {
          return;
        }
      }
      if ((cellN || 1) < cells.length) {
        cellN = (cellN || 1) + 1;
        pgN = cellN;
        plays.push(cellN);
        return;
      }
      if (menu.post) {
        menu.post();
      }
    };

    onPost();
    expect(cellCmds[0]).not.toHaveBeenCalled();
    expect(plays).toEqual([2]);
    expect(menu.post).not.toHaveBeenCalled();
  });
});
