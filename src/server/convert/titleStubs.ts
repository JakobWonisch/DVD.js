/**
 * Classify omitted title PGCs as interactive stubs (end-of-title HLI buttons)
 * or skip stubs (buttonless → silent post). Used by menus-mode convert so
 * JumpTT stays navigable without feature WebMs.
 */

'use strict';

import * as fs from 'node:fs';

import jDataView from 'jdataview';

import * as navRead from '../../dvdread/nav_read.js';
import decodePacket from '../utils/decode_packet.js';
import Stream from '../utils/stream.js';
import {
  DVD_VIDEO_LB_LEN,
  nextVobuSectorFromNav,
  type HighlightNavHit,
  type NavPtsLike,
} from './menuStillSeek.js';
import {
  buildVobExtents,
  listTitleCellsFromIfo,
  resolveLogicalSector,
  type TitleCellProbe,
  type VobExtent,
} from './titleCellSegments.js';
import { TITLE_INCLUDE_MAX_SEC } from './titleIncludePolicy.js';

/** Abort VOBU walks once elapsed PTS exceeds this (long feature cells). */
const WALK_ABORT_PTS = (TITLE_INCLUDE_MAX_SEC + 30) * 90000;

export type TitleStubKind = 'interactive' | 'skip';

export type TitleStubButton = {
  id: number;
  up: number;
  down: number;
  left: number;
  right: number;
  auto_action_mode: number;
  css: string;
  /** Raw 8-byte VM command (for generateJavaScript → btnCmd). */
  cmdBytes: number[];
};

export type TitleStubEntry = {
  kind: TitleStubKind;
  /** Interactive: cell that carries HLI buttons (usually the last). */
  cellID?: number;
  vobID?: number;
  still?: string | null;
  css?: string | null;
  still_time?: number;
  buttons?: TitleStubButton[];
  btn_nb?: number;
};

export type TitleStubMap = Record<string, TitleStubEntry>;

export type InteractiveStubTarget = {
  pgcIndex: number;
  cell: TitleCellProbe;
  highlight: HighlightNavHit;
  /** Logical sector of the HLI VOBU. */
  highlightSector: number;
};

type TitleIfoLike = Parameters<typeof listTitleCellsFromIfo>[0] & {
  vtsi_mat?: {
    vts_video_attr?: { video_format?: number };
  };
};

/**
 * For every title PGC not in includedPgcs, emit a stub:
 * - interactive when any cell has PCI HLI buttons
 * - skip otherwise (silent post)
 */
export function classifyTitlePgcStubs(
  ifo: TitleIfoLike,
  vobFiles: string[],
  includedPgcs: number[],
): { stubs: TitleStubMap; interactive: InteractiveStubTarget[] } {
  const stubs: TitleStubMap = {};
  const interactive: InteractiveStubTarget[] = [];
  const cells = listTitleCellsFromIfo(ifo);
  if (!cells.length) {
    return { stubs, interactive };
  }

  const included = new Set(includedPgcs);
  const byPgc = new Map<number, TitleCellProbe[]>();
  for (const cell of cells) {
    if (!byPgc.has(cell.pgcIndex)) {
      byPgc.set(cell.pgcIndex, []);
    }
    byPgc.get(cell.pgcIndex)!.push(cell);
  }

  const extents = vobFiles.length ? buildVobExtents(vobFiles) : [];

  byPgc.forEach(function (pgcCells, pgcIndex) {
    if (included.has(pgcIndex)) {
      return;
    }
    // Prefer the last cell with buttons (end-of-title prompts / games).
    let hit: InteractiveStubTarget | null = null;
    if (extents.length) {
      for (let i = pgcCells.length - 1; i >= 0; i--) {
        const cell = pgcCells[i];
        const highlight = findHighlightInTitleCell(
          extents,
          cell.startSector,
          cell.lastSector,
        );
        if (highlight && btnNs(highlight.nav) > 0) {
          hit = {
            pgcIndex,
            cell,
            highlight,
            highlightSector: highlight.sector,
          };
          break;
        }
      }
    }
    if (hit) {
      stubs[String(pgcIndex)] = {
        kind: 'interactive',
        cellID: hit.cell.cellId,
        vobID: hit.cell.vobId,
        still_time: stillTimeFromIfoCell(ifo, pgcIndex, hit.cell.cellIndex),
      };
      interactive.push(hit);
    } else {
      stubs[String(pgcIndex)] = { kind: 'skip' };
    }
  });

  return { stubs, interactive };
}

/**
 * Walk title-cell VOBUs for the first NAV with btn_ns > 0.
 * Stops early on long cells so feature-film probes stay cheap.
 */
export function findHighlightInTitleCell(
  extents: VobExtent[],
  startSector: number,
  lastSector: number,
): HighlightNavHit | null {
  if (
    !(startSector >= 0) ||
    !(lastSector >= startSector) ||
    !extents.length
  ) {
    return null;
  }

  let sector = startSector;
  let startPts: number | null = null;
  let guard = 0;
  const maxGuard = Math.max(16, Math.min(lastSector - startSector + 2, 4000));
  let best: HighlightNavHit | null = null;

  while (guard++ < maxGuard && sector <= lastSector) {
    const nav = readNavAtLogicalSector(extents, sector, lastSector);
    if (!nav) {
      break;
    }
    const pts = vobuStartPts(nav);
    if (startPts == null && pts != null) {
      startPts = pts;
    }
    if (startPts != null && pts != null) {
      const elapsed = ptsDiff(startPts, pts);
      // Cheap early window only — late HLI (end-of-feature prompts) is
      // handled by findHighlightNearCellEnd below.
      if (elapsed > WALK_ABORT_PTS) {
        break;
      }
    }
    if (btnNs(nav) > 0) {
      best = { sector, nav };
      // Prefer earliest HLI in the cell (same as menu pickHighlightNav).
      break;
    }
    const nxt = nextVobuSectorFromNav(sector, nav);
    if (nxt == null || nxt < 0 || nxt <= sector || nxt > lastSector) {
      break;
    }
    sector = nxt;
  }

  // Long features often put buttons only at the very end — if the early walk
  // found nothing, probe the last ~2 minutes of sectors by walking backward
  // from lastSector via reading at candidate starts.
  if (!best && lastSector - startSector > 100) {
    best = findHighlightNearCellEnd(extents, startSector, lastSector);
  }

  return best;
}

/**
 * Title-domain frame height from vts_video_attr (unlike menus, which ignore it).
 */
export function titleFrameHeightFromIfo(
  ifo: TitleIfoLike | null | undefined,
  btnit?: Array<{ y_end?: number }> | null,
  btnNsCount?: number,
): number {
  const attr = ifo && ifo.vtsi_mat && ifo.vtsi_mat.vts_video_attr;
  if (attr && attr.video_format === 1) {
    return 576;
  }
  if (attr && attr.video_format === 0) {
    return 480;
  }
  if (btnit && btnNsCount) {
    let maxY = 0;
    for (let i = 0; i < btnNsCount; i++) {
      const y = btnit[i] && btnit[i].y_end;
      if (typeof y === 'number' && y > maxY) {
        maxY = y;
      }
    }
    if (maxY >= 480) {
      return 576;
    }
  }
  return 480;
}

export function buttonGeomCss(
  btn: {
    x_start: number;
    y_start: number;
    x_end: number;
    y_end: number;
  },
  frameHeight: number,
): string {
  const fh = frameHeight || 480;
  return (
    'left:' +
    roundPct((btn.x_start / 720) * 100) +
    '%;' +
    'top:' +
    roundPct((btn.y_start / fh) * 100) +
    '%;' +
    'width:' +
    roundPct(((btn.x_end - btn.x_start) / 720) * 100) +
    '%;' +
    'height:' +
    roundPct(((btn.y_end - btn.y_start) / fh) * 100) +
    '%;'
  );
}

export function buildStubButtonsFromNav(
  nav: NavPtsLike,
  frameHeight: number,
): TitleStubButton[] {
  const gi = nav.pci && nav.pci.hli && nav.pci.hli.hl_gi;
  const btnit = nav.pci && nav.pci.hli && nav.pci.hli.btnit;
  const n = gi && gi.btn_ns ? gi.btn_ns : 0;
  if (!n || !btnit) {
    return [];
  }
  const out: TitleStubButton[] = [];
  for (let i = 0; i < n; i++) {
    const btn = btnit[i] as {
      x_start: number;
      y_start: number;
      x_end: number;
      y_end: number;
      up?: number;
      down?: number;
      left?: number;
      right?: number;
      auto_action_mode?: number;
      cmd?: { bytes?: number[] };
    };
    if (!btn) {
      continue;
    }
    const bytes =
      btn.cmd && Array.isArray(btn.cmd.bytes)
        ? btn.cmd.bytes.map(function (b) {
            return b & 0xff;
          })
        : [0, 0, 0, 0, 0, 0, 0, 0];
    out.push({
      id: i,
      up: btn.up || 0,
      down: btn.down || 0,
      left: btn.left || 0,
      right: btn.right || 0,
      auto_action_mode: btn.auto_action_mode || 0,
      css: buttonGeomCss(btn, frameHeight),
      cmdBytes: bytes,
    });
  }
  return out;
}

function findHighlightNearCellEnd(
  extents: VobExtent[],
  startSector: number,
  lastSector: number,
): HighlightNavHit | null {
  // Dense scan of the last ~2–3 minutes of packs (feature end-credits prompts
  // often sit only here). Coarse sampling previously skipped the HLI VOBU and
  // classified interactive PGCs as silent skip stubs.
  const span = lastSector - startSector;
  const denseWindow = Math.min(span, 2500);
  const denseStart = Math.max(startSector, lastSector - denseWindow);
  for (let s = lastSector; s >= denseStart; s--) {
    const nav = readNavAtLogicalSector(extents, s, lastSector);
    if (nav && btnNs(nav) > 0) {
      return { sector: s, nav };
    }
  }
  // Remainder of the cell: coarser backward sample in case HLI is mid-feature.
  if (denseStart > startSector) {
    const step = Math.max(1, Math.floor((denseStart - startSector) / 64));
    for (let s = denseStart - 1; s >= startSector; s -= step) {
      const nav = readNavAtLogicalSector(extents, s, lastSector);
      if (nav && btnNs(nav) > 0) {
        return { sector: s, nav };
      }
      if (step > 1) {
        for (let d = 0; d < Math.min(step, 8); d++) {
          const t = s - d;
          if (t < startSector) {
            break;
          }
          const n2 = readNavAtLogicalSector(extents, t, lastSector);
          if (n2 && btnNs(n2) > 0) {
            return { sector: t, nav: n2 };
          }
        }
      }
    }
  }
  return null;
}

function stillTimeFromIfoCell(
  ifo: TitleIfoLike,
  pgcIndex: number,
  cellIndex: number,
): number {
  const srps = ifo.vts_pgcit && ifo.vts_pgcit.pgci_srp;
  const pgc = srps && srps[pgcIndex - 1] && srps[pgcIndex - 1].pgc;
  const playback = pgc && pgc.cell_playback && pgc.cell_playback[cellIndex];
  const st = playback && (playback as { still_time?: number }).still_time;
  return typeof st === 'number' ? st : 0;
}

function btnNs(nav: NavPtsLike | null | undefined): number {
  return (nav && nav.pci && nav.pci.hli && nav.pci.hli.hl_gi && nav.pci.hli.hl_gi.btn_ns) || 0;
}

function vobuStartPts(nav: NavPtsLike): number | null {
  const pts = nav.pci && nav.pci.pci_gi && nav.pci.pci_gi.vobu_s_ptm;
  return pts != null ? pts : null;
}

function ptsDiff(startPts: number, endPts: number): number {
  return (endPts - startPts) >>> 0;
}

function roundPct(val: number): number | string {
  const s = val.toFixed(1);
  if (s.substr(-1) === '0') {
    return Math.round(val);
  }
  return s;
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
  return readNavAtFileSector(resolved.path, resolved.sectorInFile, maxDelta);
}

function readNavAtFileSector(
  filePath: string,
  sectorInFile: number,
  maxDelta: number = 7,
): NavPtsLike | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const fd = fs.openSync(filePath, 'r');
    try {
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
