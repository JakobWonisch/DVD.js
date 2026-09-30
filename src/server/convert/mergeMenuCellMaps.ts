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
  'video',
] as const;

export type MenuCellEntry = Record<string, unknown>;
export type MenuCellMap = Record<string, Record<string, MenuCellEntry>>;

/**
 * Merge still-table entries into existing menuCell metadata, preserving
 * button/CSS/SPU/video fields from prior convert steps for keys still present.
 *
 * Only keys from `incoming` (current C_ADT) are kept — prev-only ghost cells
 * would otherwise stay in encode plans and desync timelines on reconvert.
 *
 * `still` handling:
 * - incoming omits `still` → keep previous URL
 * - incoming `still: null` → clear (pure transition cell)
 * - incoming `still: "/…"` → use new URL
 */
export function mergeMenuCellMaps(
  existing: MenuCellMap | null | undefined,
  incoming: MenuCellMap | null | undefined,
): MenuCellMap {
  const prev = existing || {};
  const next = incoming || {};
  const out: MenuCellMap = {};

  for (const cellId of Object.keys(next)) {
    const prevVobs = prev[cellId] || {};
    const nextVobs = next[cellId] || {};
    out[cellId] = {};
    for (const vobId of Object.keys(nextVobs)) {
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
    if (out.still == null) {
      delete out.still;
    }
    return out;
  }
  for (const key of MENU_CELL_PRESERVE_KEYS) {
    if (out[key] == null && prev[key] != null) {
      out[key] = prev[key];
    }
  }
  if (Object.prototype.hasOwnProperty.call(next, 'still')) {
    if (next.still == null || next.still === '') {
      delete out.still;
    } else {
      out.still = next.still;
    }
  } else if (prev.still != null) {
    out.still = prev.still;
  }
  return out;
}
