/**
 * Keep menu pgN aligned with cellN for LinkNextPG / LinkPrevPG.
 *
 * Older generated vm.js advanced cellN in playCurrentMenuCell onPost (transition
 * → interactive page) without updating pgN. Button LinkNextPG does
 * `pgN += 1; cellN = pgN`, so the first press replayed the same page
 * (Harry Potter Special Features B0 → Cast & Crew needed two clicks).
 */
export function patchPlayCurrentMenuCellPgN(g: Record<string, unknown>): void {
  const orig = g.playCurrentMenuCell;
  if (typeof orig !== 'function' || g._dvdjsPgNPatched) {
    return;
  }
  g._dvdjsPgNPatched = true;
  g.playCurrentMenuCell = function playCurrentMenuCellPatched(
    this: unknown,
    ...args: unknown[]
  ) {
    if (typeof g.cellN === 'number') {
      g.pgN = g.cellN;
    }
    return (orig as (...a: unknown[]) => unknown).apply(this, args);
  };
}
