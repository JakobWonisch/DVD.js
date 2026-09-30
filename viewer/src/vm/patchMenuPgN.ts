/**
 * Keep menu pgN aligned with cellN for LinkNextPG / LinkPrevPG.
 *
 * Older generated vm.js advanced cellN in playCurrentMenuCell onPost (transition
 * → interactive page) without updating pgN. Button LinkNextPG does
 * `pgN += 1; cellN = pgN`, so the first press replayed the same page
 * (Harry Potter Special Features B0 → Cast & Crew needed two clicks).
 *
 * Also: LinkPGN/CN inside title pre (Shrek trivia) must not force menu space.
 * Older vm.js always did `pgcSpace = "menu"` at playCurrentMenuCell entry,
 * landing on a buttonless infinite still instead of the answer WebM.
 */
export function patchPlayCurrentMenuCellPgN(g: Record<string, unknown>): void {
  const orig = g.playCurrentMenuCell;
  if (typeof orig !== 'function' || g._dvdjsPgNPatched) {
    return;
  }
  g._dvdjsPgNPatched = true;

  if (typeof g.playCurrentTitleCell !== 'function') {
    g.playCurrentTitleCell = function playCurrentTitleCellInjected() {
      g.pgcSpace = 'title';
      if (typeof g.cellN === 'number') {
        g.pgN = g.cellN;
      }
      const domain = g.domain as number;
      const pgc = g.pgc as number;
      const cellN =
        typeof g.cellN === 'number' && g.cellN > 0 ? (g.cellN as number) : 1;
      const title =
        (g.PGCIUT as any)?.[domain]?.[pgc] ||
        null;
      const cells = (title && title.cells) || [];
      const idx = cells.length
        ? Math.max(0, Math.min(cellN - 1, cells.length - 1))
        : 0;
      const cell = cells[idx] || {};
      const dvdHost =
        (typeof window !== 'undefined' && (window as any).dvd) ||
        (globalThis as any).dvd ||
        null;
      const dvd = dvdHost as {
        playTitleCell?: (opts: Record<string, unknown>) => void;
        playTitlePgc?: (d: number, p: number) => void;
        playByID?: (id: string) => void;
      } | null;
      if (!dvd || typeof dvd.playTitleCell !== 'function') {
        if (dvd && typeof dvd.playTitlePgc === 'function') {
          dvd.playTitlePgc(domain, pgc);
        } else if (dvd && typeof dvd.playByID === 'function') {
          dvd.playByID('video-' + domain);
        }
        return;
      }
      dvd.playTitleCell({
        domain,
        pgc,
        cellN,
        cellID: cell.cellID,
        vobID: cell.vobID,
        still_time: cell.still_time || 0,
        startSec: cell.startSec,
        endSec: cell.endSec,
        onPost: function () {
          const cmdNr = cell.cell_cmd_nr || 0;
          if (
            cmdNr &&
            title &&
            title.cellCmds &&
            typeof title.cellCmds[cmdNr - 1] === 'function'
          ) {
            if (title.cellCmds[cmdNr - 1]()) {
              return;
            }
          }
          if (cells.length && cellN < cells.length) {
            g.cellN = cellN + 1;
            g.pgN = g.cellN;
            (g.playCurrentTitleCell as () => void)();
            return;
          }
          if (title && typeof title.post === 'function') {
            title.post();
          }
        },
      });
    };
  }

  g.playCurrentMenuCell = function playCurrentMenuCellPatched(
    this: unknown,
    ...args: unknown[]
  ) {
    // Title-domain LinkPGN/CN: play the title cell, do not enter menu stills.
    if (g.pgcSpace === 'title') {
      return (g.playCurrentTitleCell as (...a: unknown[]) => unknown).apply(
        this,
        args,
      );
    }
    if (typeof g.cellN === 'number') {
      g.pgN = g.cellN;
    }
    return (orig as (...a: unknown[]) => unknown).apply(this, args);
  };
}
