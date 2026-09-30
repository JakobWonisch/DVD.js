import { describe, expect, it, vi } from 'vitest';
import { patchPlayCurrentMenuCellPgN } from '../../viewer/src/vm/patchMenuPgN.ts';

describe('patchPlayCurrentMenuCellPgN title LinkPGN', () => {
  it('dispatches title-space playCurrentMenuCell to playTitleCell', () => {
    const playTitleCell = vi.fn();
    (globalThis as any).dvd = { playTitleCell };
    const g: Record<string, unknown> = {
      pgcSpace: 'title',
      domain: 7,
      pgc: 1,
      cellN: 3,
      pgN: 1,
      PGCIUT: {
        7: {
          1: {
            cells: [
              { cellID: 1, vobID: 1, startSec: 0, endSec: 2, cell_cmd_nr: 1 },
              { cellID: 1, vobID: 2, startSec: 2, endSec: 50, cell_cmd_nr: 1 },
              { cellID: 1, vobID: 3, startSec: 50, endSec: 85, cell_cmd_nr: 1 },
            ],
            cellCmds: [vi.fn(() => 1)],
            post: vi.fn(),
          },
        },
      },
      playCurrentMenuCell: vi.fn(() => {
        // Old vm.js: would force menu and stick.
        g.pgcSpace = 'menu';
      }),
    };

    patchPlayCurrentMenuCellPgN(g);
    (g.playCurrentMenuCell as () => void)();

    expect(g.pgcSpace).toBe('title');
    expect(playTitleCell).toHaveBeenCalledOnce();
    expect(playTitleCell.mock.calls[0][0]).toMatchObject({
      domain: 7,
      pgc: 1,
      cellN: 3,
      startSec: 50,
      endSec: 85,
    });
    // Must not have run the original menu-forcing body.
    expect(g.playCurrentMenuCell).not.toBe(g.PGCIUT);
  });

  it('still syncs pgN for menu space', () => {
    const orig = vi.fn();
    const g: Record<string, unknown> = {
      pgcSpace: 'menu',
      cellN: 4,
      pgN: 1,
      playCurrentMenuCell: orig,
    };
    patchPlayCurrentMenuCellPgN(g);
    (g.playCurrentMenuCell as () => void)();
    expect(g.pgN).toBe(4);
    expect(orig).toHaveBeenCalledOnce();
  });
});
