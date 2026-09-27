/**
 * Keys owned by generateButtons / extractSpu — still extraction must not drop them.
 */
export const MENU_CELL_PRESERVE_KEYS = [
  'css',
  'btn_nb',
  'buttons',
  'hli_s_ptm',
  'hli_e_ptm',
  'spu',
  'spuSelect',
  'spuActivate',
  'spuFrameHeight',
] as const;

export type MenuCellEntry = Record<string, unknown>;
export type MenuCellMap = Record<string, Record<string, MenuCellEntry>>;

/**
 * Merge still-table entries into existing menuCell metadata, preserving
 * button/CSS/SPU fields from prior convert steps.
 */
export function mergeMenuCellMaps(
  existing: MenuCellMap | null | undefined,
  incoming: MenuCellMap | null | undefined,
): MenuCellMap {
  const prev = existing || {};
  const next = incoming || {};
  const out: MenuCellMap = {};
  const cellIds = new Set([...Object.keys(prev), ...Object.keys(next)]);

  for (const cellId of cellIds) {
    const prevVobs = prev[cellId] || {};
    const nextVobs = next[cellId] || {};
    out[cellId] = {};
    const vobIds = new Set([
      ...Object.keys(prevVobs),
      ...Object.keys(nextVobs),
    ]);
    for (const vobId of vobIds) {
      out[cellId][vobId] = mergeMenuCellEntry(prevVobs[vobId], nextVobs[vobId]);
    }
  }

  return out;
}

function mergeMenuCellEntry(
  prev: MenuCellEntry | undefined,
  next: MenuCellEntry | undefined,
): MenuCellEntry {
  if (!next) {
    return { ...(prev || {}) };
  }
  const out: MenuCellEntry = { ...next };
  if (!prev) {
    return out;
  }
  for (const key of MENU_CELL_PRESERVE_KEYS) {
    if (out[key] == null && prev[key] != null) {
      out[key] = prev[key];
    }
  }
  return out;
}
