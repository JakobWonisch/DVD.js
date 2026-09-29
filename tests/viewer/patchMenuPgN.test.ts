import { describe, expect, it, vi } from 'vitest';
import { patchPlayCurrentMenuCellPgN } from '../../viewer/src/vm/patchMenuPgN.ts';

describe('patchPlayCurrentMenuCellPgN', () => {
  it('heals stale pgN when onPost advances cellN then replays (HP Special Features)', () => {
    const seen: Array<{ pgN: unknown; cellN: unknown }> = [];
    const g: Record<string, unknown> = {
      cellN: 1,
      pgN: 1,
      playCurrentMenuCell() {
        seen.push({ pgN: g.pgN, cellN: g.cellN });
      },
    };
    patchPlayCurrentMenuCellPgN(g);

    // Transition cell ended — older vm.js onPost bumps cellN only.
    g.cellN = 2;
    (g.playCurrentMenuCell as () => void)();
    expect(g.pgN).toBe(2);
    expect(seen[0]).toEqual({ pgN: 2, cellN: 2 });

    // First user LinkNextPG (Special Features B0) must reach Cast & Crew.
    g.pgN = (g.pgN as number) + 1;
    g.cellN = g.pgN;
    (g.playCurrentMenuCell as () => void)();
    expect(g.pgN).toBe(3);
    expect(g.cellN).toBe(3);
    expect(seen[1]).toEqual({ pgN: 3, cellN: 3 });
  });

  it('is idempotent', () => {
    const inner = vi.fn();
    const g: Record<string, unknown> = {
      cellN: 1,
      pgN: 1,
      playCurrentMenuCell: inner,
    };
    patchPlayCurrentMenuCellPgN(g);
    const once = g.playCurrentMenuCell;
    patchPlayCurrentMenuCellPgN(g);
    expect(g.playCurrentMenuCell).toBe(once);
    (g.playCurrentMenuCell as () => void)();
    expect(inner).toHaveBeenCalledOnce();
  });
});
