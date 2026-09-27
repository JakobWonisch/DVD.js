/**
 * Number of cell address entries in a menu C_ADT.
 *
 * Prefer cell_adr_table.length over nr_of_vobs: nr_of_vobs counts unique VOB
 * IDs, while the table has one row per cell (a VOB can contain multiple cells).
 * Iterating only nr_of_vobs skips trailing cells when any VOB is multi-cell.
 */
export function menuCellAdrCount(
  menu_c_adt:
    | {
        cell_adr_table?: unknown[] | null;
        nr_of_vobs?: number;
      }
    | null
    | undefined,
): number {
  if (!menu_c_adt) {
    return 0;
  }
  const n = menu_c_adt.cell_adr_table?.length;
  if (typeof n === 'number' && n > 0) {
    return n;
  }
  return menu_c_adt.nr_of_vobs || 0;
}
