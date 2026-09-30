/**
 * Short title-cell encode plan: measure cell length from VOB NAV PTS
 * (vobu_s_ptm → vobu_e_ptm), keep cells ≤ TITLE_INCLUDE_MAX_SEC that belong
 * to fully-short title PGCs, and map them onto a compact WebM timeline.
 */

'use strict';

import * as fs from 'node:fs';

import jDataView from 'jdataview';

import * as navRead from '../../dvdread/nav_read.js';
import decodePacket from '../utils/decode_packet.js';
import Stream from '../utils/stream.js';
import { dvdTimeToSeconds } from '../utils/dvdTime.js';
import {
  DVD_VIDEO_LB_LEN,
  nextVobuSectorFromNav,
  type NavPtsLike,
} from './menuStillSeek.js';
import { TITLE_INCLUDE_MAX_SEC } from './titleIncludePolicy.js';

const PTS_HZ = 90000;
/** Abort VOBU walks once elapsed PTS exceeds this (long feature cells). */
const WALK_ABORT_PTS = (TITLE_INCLUDE_MAX_SEC + 5) * PTS_HZ;

export type VobExtent = {
  path: string;
  /** Number of 2048-byte sectors in this file. */
  sectorCount: number;
};

export type TitleCellProbe = {
  pgcIndex: number;
  cellIndex: number;
  cellId: number;
  vobId: number;
  startSector: number;
  lastSector: number;
  ifoDurationSec: number;
  /** Duration from VOB NAV PTS when probed; otherwise IFO fallback. */
  durationSec: number;
  cell_cmd_nr: number;
  still_time: number;
};

export type TitleEncodeSegment = {
  startSec: number;
  endSec: number;
  durationSec: number;
  skipBytes: number;
  /** Exclusive end byte in `inputPath` (clip before encode to avoid bleed). */
  endBytes: number;
  /** Absolute path of the VOB file that contains this cell. */
  inputPath: string;
  cellId: string;
  vobId: string;
  label: string;
  startSector: number;
  lastSector: number;
};

export type TitlePgcTimeline = {
  startSec: number;
  endSec: number;
};

export type TitlePgcCellTimeline = {
  startSec: number;
  endSec: number;
  cellID: number;
  vobID: number;
  cell_cmd_nr?: number;
  still_time?: number;
};

export type TitlePgcMedia = {
  /** 1-based PGC indices fully covered by encoded short cells. */
  includedPgcs: number[];
  /** Remapped WebM timeline per included PGC. */
  pgcTimeline: Record<string, TitlePgcTimeline>;
  /**
   * Per-cell remapped WebM windows for included PGCs (LinkPGN / LinkCN in
   * title domain — Shrek trivia answer clips, etc.).
   */
  pgcCells?: Record<string, TitlePgcCellTimeline[]>;
  /**
   * Omitted title PGCs (menus mode): interactive = still+buttons stub;
   * skip = silent PGC post. Filled by generateTitleStubs; encode merges.
   */
  stubs?: Record<
    string,
    {
      kind: 'interactive' | 'skip';
      cellID?: number;
      vobID?: number;
      still?: string | null;
      css?: string | null;
      still_time?: number;
      buttons?: unknown[];
      btn_nb?: number;
    }
  >;
};

export type ShortTitleEncodePlan = {
  segments: TitleEncodeSegment[];
  titlePgcMedia: TitlePgcMedia;
};

type CellPlayback = {
  playback_time?: {
    hour?: number;
    minute?: number;
    second?: number;
    frame_u?: number;
  } | null;
  first_sector?: number;
  last_sector?: number;
  cell_cmd_nr?: number;
  still_time?: number;
};

type CellPosition = {
  cell_nr?: number;
  vob_id_nr?: number;
};

type TitleIfoLike = {
  vts_pgcit?: {
    pgci_srp?: Array<{
      pgc?: {
        cell_playback?: CellPlayback[] | null;
        cell_position?: CellPosition[] | null;
      } | null;
    }> | null;
  } | null;
};

/**
 * Build sector extents for a concatenated title VOB group (VTS_XX_1+).
 * Logical sector 0 is the first byte of the first file.
 */
export function buildVobExtents(vobFiles: string[]): VobExtent[] {
  const out: VobExtent[] = [];
  for (const filePath of vobFiles) {
    try {
      const size = fs.statSync(filePath).size;
      out.push({
        path: filePath,
        sectorCount: Math.floor(size / DVD_VIDEO_LB_LEN),
      });
    } catch (e) {
      out.push({ path: filePath, sectorCount: 0 });
    }
  }
  return out;
}

export function resolveLogicalSector(
  extents: VobExtent[],
  logicalSector: number,
): { path: string; sectorInFile: number } | null {
  if (!(logicalSector >= 0) || !extents.length) {
    return null;
  }
  let remaining = logicalSector;
  for (let i = 0; i < extents.length; i++) {
    const ext = extents[i];
    if (remaining < ext.sectorCount) {
      return { path: ext.path, sectorInFile: remaining };
    }
    remaining -= ext.sectorCount;
  }
  return null;
}

/**
 * Split a logical cell sector range into per-VOB file byte ranges when the
 * cell spans VTS_XX_1.VOB → VTS_XX_2.VOB (etc.).
 */
export function splitCellAcrossVobFiles(
  extents: VobExtent[],
  startSector: number,
  lastSector: number,
): Array<{
  path: string;
  skipBytes: number;
  endBytes: number;
  startSector: number;
  lastSector: number;
}> {
  const out: Array<{
    path: string;
    skipBytes: number;
    endBytes: number;
    startSector: number;
    lastSector: number;
  }> = [];
  if (!(startSector >= 0) || !(lastSector >= startSector) || !extents.length) {
    return out;
  }
  let offset = 0;
  for (let i = 0; i < extents.length; i++) {
    const ext = extents[i];
    const extStart = offset;
    const extEnd = offset + ext.sectorCount - 1;
    offset += ext.sectorCount;
    if (ext.sectorCount <= 0) {
      continue;
    }
    if (lastSector < extStart || startSector > extEnd) {
      continue;
    }
    const partStart = Math.max(startSector, extStart);
    const partLast = Math.min(lastSector, extEnd);
    const sectorInFileStart = partStart - extStart;
    const sectorInFileLast = partLast - extStart;
    out.push({
      path: ext.path,
      skipBytes: sectorInFileStart * DVD_VIDEO_LB_LEN,
      endBytes: (sectorInFileLast + 1) * DVD_VIDEO_LB_LEN,
      startSector: partStart,
      lastSector: partLast,
    });
  }
  return out;
}

/**
 * True length of a cell from NAV presentation timestamps in the VOB.
 * Returns 0 when NAVs cannot be read.
 */
export function probeCellDurationSec(
  extents: VobExtent[],
  startSector: number,
  lastSector: number,
): number {
  if (
    !(startSector >= 0) ||
    !(lastSector >= startSector) ||
    !extents.length
  ) {
    return 0;
  }

  const startNav = readNavAtLogicalSector(extents, startSector, lastSector);
  if (!startNav) {
    return 0;
  }
  const startPts = vobuStartPts(startNav);
  if (startPts == null) {
    return 0;
  }

  let sector = startSector;
  let endPts = vobuEndPts(startNav);
  if (endPts == null) {
    endPts = startPts;
  }
  let guard = 0;
  const maxGuard = Math.max(8, lastSector - startSector + 2);

  while (guard++ < maxGuard) {
    const elapsed = ptsDiff(startPts, endPts);
    if (elapsed > WALK_ABORT_PTS) {
      return elapsed / PTS_HZ;
    }

    const cur = readNavAtLogicalSector(extents, sector, lastSector);
    if (!cur) {
      break;
    }
    const curEnd = vobuEndPts(cur);
    if (curEnd != null) {
      endPts = curEnd;
    }

    const nxt = nextVobuSectorFromNav(sector, cur);
    if (nxt == null || nxt < 0) {
      break;
    }
    if (nxt > lastSector) {
      break;
    }
    if (nxt <= sector) {
      break;
    }
    sector = nxt;
  }

  return ptsDiff(startPts, endPts) / PTS_HZ;
}

/**
 * List title cells from VTS_PGCIT with IFO durations and sector ranges.
 */
export function listTitleCellsFromIfo(ifo: TitleIfoLike): TitleCellProbe[] {
  const srps = ifo.vts_pgcit && ifo.vts_pgcit.pgci_srp;
  if (!srps || !srps.length) {
    return [];
  }
  const out: TitleCellProbe[] = [];
  for (let i = 0; i < srps.length; i++) {
    const pgc = srps[i] && srps[i].pgc;
    if (!pgc || !pgc.cell_playback || !pgc.cell_playback.length) {
      continue;
    }
    const pgcIndex = i + 1;
    for (let c = 0; c < pgc.cell_playback.length; c++) {
      const playback = pgc.cell_playback[c];
      const pos = pgc.cell_position && pgc.cell_position[c];
      const startSector =
        playback && playback.first_sector != null
          ? playback.first_sector
          : -1;
      const lastSector =
        playback && playback.last_sector != null
          ? playback.last_sector
          : -1;
      if (!(startSector >= 0) || !(lastSector >= startSector)) {
        continue;
      }
      const ifoDurationSec = dvdTimeToSeconds(
        playback && playback.playback_time,
      );
      out.push({
        pgcIndex,
        cellIndex: c,
        cellId: pos && pos.cell_nr != null ? pos.cell_nr : c + 1,
        vobId: pos && pos.vob_id_nr != null ? pos.vob_id_nr : 1,
        startSector,
        lastSector,
        ifoDurationSec,
        durationSec: ifoDurationSec,
        cell_cmd_nr:
          playback && playback.cell_cmd_nr != null ? playback.cell_cmd_nr : 0,
        still_time:
          playback && playback.still_time != null ? playback.still_time : 0,
      });
    }
  }
  return out;
}

/**
 * Build an encode plan: only PGCs whose every cell is ≤ maxSec (VOB PTS,
 * falling back to IFO). Long feature PGCs contribute nothing — keeps
 * copyright/feature cells out while games in the same VTS can still encode.
 */
export function buildShortTitleEncodePlan(
  ifo: TitleIfoLike,
  vobFiles: string[],
  maxSec: number = TITLE_INCLUDE_MAX_SEC,
): ShortTitleEncodePlan {
  const empty: ShortTitleEncodePlan = {
    segments: [],
    titlePgcMedia: { includedPgcs: [], pgcTimeline: {}, pgcCells: {} },
  };
  const cells = listTitleCellsFromIfo(ifo);
  if (!cells.length || !vobFiles.length) {
    return empty;
  }

  const extents = buildVobExtents(vobFiles);
  const byPgc = new Map<number, TitleCellProbe[]>();
  for (const cell of cells) {
    // Cheap reject before opening the VOB.
    if (cell.ifoDurationSec > maxSec) {
      cell.durationSec = cell.ifoDurationSec;
    } else {
      const probed = probeCellDurationSec(
        extents,
        cell.startSector,
        cell.lastSector,
      );
      cell.durationSec = probed > 0 ? probed : cell.ifoDurationSec;
    }
    if (!byPgc.has(cell.pgcIndex)) {
      byPgc.set(cell.pgcIndex, []);
    }
    byPgc.get(cell.pgcIndex)!.push(cell);
  }

  const includedPgcs: number[] = [];
  const selected: TitleCellProbe[] = [];
  const selectedKeys = new Set<string>();

  byPgc.forEach(function (pgcCells, pgcIndex) {
    const allShort = pgcCells.every(function (c) {
      return c.durationSec > 0 && c.durationSec <= maxSec;
    });
    if (!allShort) {
      return;
    }
    includedPgcs.push(pgcIndex);
    for (const c of pgcCells) {
      const key = c.startSector + ':' + c.lastSector;
      if (selectedKeys.has(key)) {
        continue;
      }
      selectedKeys.add(key);
      selected.push(c);
    }
  });

  includedPgcs.sort(function (a, b) {
    return a - b;
  });
  selected.sort(function (a, b) {
    return a.startSector - b.startSector;
  });

  if (!selected.length) {
    return empty;
  }

  const segments: TitleEncodeSegment[] = [];
  let t = 0;
  for (const cell of selected) {
    const parts = splitCellAcrossVobFiles(
      extents,
      cell.startSector,
      cell.lastSector,
    );
    if (!parts.length) {
      continue;
    }
    const durationSec = cell.durationSec;
    const totalSectors = cell.lastSector - cell.startSector + 1;
    let cellStartT = t;
    for (let pi = 0; pi < parts.length; pi++) {
      const part = parts[pi];
      const partSectors = part.lastSector - part.startSector + 1;
      const partDur =
        totalSectors > 0
          ? durationSec * (partSectors / totalSectors)
          : durationSec;
      segments.push({
        startSec: t,
        endSec: t + partDur,
        durationSec: partDur,
        skipBytes: part.skipBytes,
        endBytes: part.endBytes,
        inputPath: part.path,
        cellId: String(cell.cellId),
        vobId: String(cell.vobId),
        label:
          cell.pgcIndex +
          ':' +
          cell.cellId +
          ':' +
          cell.vobId +
          (parts.length > 1 ? ':p' + pi : ''),
        // Keep the full cell key on every part so PGC remapping still finds it.
        startSector: cell.startSector,
        lastSector: cell.lastSector,
      });
      t += partDur;
    }
    void cellStartT;
  }

  if (!segments.length) {
    return empty;
  }

  // Remap PGC timelines from the cells that made it into segments.
  const pgcTimeline: Record<string, TitlePgcTimeline> = {};
  // Multi-VOB cells produce several segments with the same cell key — fold them.
  const segBySector = new Map<
    string,
    { startSec: number; endSec: number; parts: TitleEncodeSegment[] }
  >();
  for (const seg of segments) {
    const key = seg.startSector + ':' + seg.lastSector;
    const prev = segBySector.get(key);
    if (!prev) {
      segBySector.set(key, {
        startSec: seg.startSec,
        endSec: seg.endSec,
        parts: [seg],
      });
    } else {
      prev.startSec = Math.min(prev.startSec, seg.startSec);
      prev.endSec = Math.max(prev.endSec, seg.endSec);
      prev.parts.push(seg);
    }
  }

  const finalPgcs: number[] = [];
  byPgc.forEach(function (pgcCells, pgcIndex) {
    if (includedPgcs.indexOf(pgcIndex) < 0) {
      return;
    }
    let startSec = Infinity;
    let endSec = -Infinity;
    let ok = true;
    for (const c of pgcCells) {
      const seg = segBySector.get(c.startSector + ':' + c.lastSector);
      if (!seg) {
        ok = false;
        break;
      }
      if (seg.startSec < startSec) {
        startSec = seg.startSec;
      }
      if (seg.endSec > endSec) {
        endSec = seg.endSec;
      }
    }
    if (!ok || !(endSec > startSec)) {
      return;
    }
    finalPgcs.push(pgcIndex);
    pgcTimeline[String(pgcIndex)] = { startSec, endSec };
  });

  // Drop segments that no longer belong to any surviving PGC.
  const keepSectors = new Set<string>();
  byPgc.forEach(function (pgcCells, pgcIndex) {
    if (finalPgcs.indexOf(pgcIndex) < 0) {
      return;
    }
    for (const c of pgcCells) {
      keepSectors.add(c.startSector + ':' + c.lastSector);
    }
  });
  const finalSegments = segments.filter(function (seg) {
    return keepSectors.has(seg.startSector + ':' + seg.lastSector);
  });

  // Re-stamp contiguous timeline after drops.
  let t2 = 0;
  const sectorRemap = new Map<string, { startSec: number; endSec: number }>();
  for (const seg of finalSegments) {
    const dur = seg.durationSec;
    seg.startSec = t2;
    seg.endSec = t2 + dur;
    const key = seg.startSector + ':' + seg.lastSector;
    const prev = sectorRemap.get(key);
    if (!prev) {
      sectorRemap.set(key, {
        startSec: seg.startSec,
        endSec: seg.endSec,
      });
    } else {
      // Multi-VOB parts share a cell key — keep first start, extend end.
      prev.endSec = seg.endSec;
    }
    t2 += dur;
  }
  for (const pgcIndex of finalPgcs) {
    const pgcCells = byPgc.get(pgcIndex) || [];
    let startSec = Infinity;
    let endSec = -Infinity;
    for (const c of pgcCells) {
      const m = sectorRemap.get(c.startSector + ':' + c.lastSector);
      if (!m) {
        continue;
      }
      if (m.startSec < startSec) {
        startSec = m.startSec;
      }
      if (m.endSec > endSec) {
        endSec = m.endSec;
      }
    }
    if (endSec > startSec) {
      pgcTimeline[String(pgcIndex)] = { startSec, endSec };
    }
  }

  const pgcCellMap: Record<string, TitlePgcCellTimeline[]> = {};
  for (const pgcIndex of finalPgcs) {
    const pgcCells = byPgc.get(pgcIndex) || [];
    // Keep IFO cell order (program / LinkPGN index), not sector-sort order.
    const ordered = pgcCells.slice().sort(function (a, b) {
      return a.cellIndex - b.cellIndex;
    });
    const list: TitlePgcCellTimeline[] = [];
    for (const c of ordered) {
      const m = sectorRemap.get(c.startSector + ':' + c.lastSector);
      if (!m) {
        continue;
      }
      list.push({
        startSec: m.startSec,
        endSec: m.endSec,
        cellID: c.cellId,
        vobID: c.vobId,
        cell_cmd_nr: c.cell_cmd_nr,
        still_time: c.still_time,
      });
    }
    if (list.length) {
      pgcCellMap[String(pgcIndex)] = list;
    }
  }

  return {
    segments: finalSegments,
    titlePgcMedia: {
      includedPgcs: finalPgcs,
      pgcTimeline,
      pgcCells: pgcCellMap,
    },
  };
}

function readNavAtLogicalSector(
  extents: VobExtent[],
  logicalSector: number,
  maxLogicalSector?: number,
): NavPtsLike | null {
  const resolved = resolveLogicalSector(extents, logicalSector);
  if (!resolved) {
    return null;
  }
  const maxDelta =
    maxLogicalSector != null && maxLogicalSector >= logicalSector
      ? Math.min(7, maxLogicalSector - logicalSector)
      : 7;
  return readNavAtFileSector(
    resolved.path,
    resolved.sectorInFile,
    maxDelta,
  );
}

function readNavAtFileSector(
  filePath: string,
  sectorInFile: number,
  maxDelta: number = 7,
): NavPtsLike | null {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      // Scan a few packs forward if the exact sector is not a NAV — but never
      // past maxDelta (caller clamps to the cell's last_sector).
      for (let delta = 0; delta <= maxDelta; delta++) {
        const buf = Buffer.alloc(DVD_VIDEO_LB_LEN);
        const offset = (sectorInFile + delta) * DVD_VIDEO_LB_LEN;
        const n = fs.readSync(fd, buf, 0, DVD_VIDEO_LB_LEN, offset);
        if (n < DVD_VIDEO_LB_LEN) {
          return null;
        }
        const stream = new Stream(buf);
        const packets = decodePacket(stream);
        if (!packets.pci || !packets.dsi) {
          continue;
        }
        return {
          pci: navRead.parsePCI(
            new jDataView(packets.pci, undefined, undefined, false),
          ),
          dsi: navRead.parseDSI(
            new jDataView(packets.dsi, undefined, undefined, false),
          ),
        };
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    return null;
  }
  return null;
}

function vobuStartPts(nav: NavPtsLike): number | null {
  const pts = nav.pci && nav.pci.pci_gi && nav.pci.pci_gi.vobu_s_ptm;
  return pts != null ? pts : null;
}

function vobuEndPts(nav: NavPtsLike): number | null {
  const gi = nav.pci && nav.pci.pci_gi;
  if (!gi) {
    return null;
  }
  if (gi.vobu_e_ptm != null) {
    return gi.vobu_e_ptm;
  }
  return null;
}

/** Unsigned 32-bit PTS delta (handles wrap). */
function ptsDiff(startPts: number, endPts: number): number {
  var d = (endPts - startPts) >>> 0;
  return d;
}
