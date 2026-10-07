/**
 * Find menu cells whose buttons start the main (longest) title — used to
 * pick a smarter catalogue cover.jpg than “first Title/Root still”.
 *
 * Matches:
 *   - JumpTT / JumpVTS_TT / JumpVTS_PTT(ch1) on the button
 *   - LinkPGCN to a menu PGC whose pre/post/cell cmds jump to that title
 *   - JumpSS/CallSS VMGM_PGC to such a trampoline on the VMGM
 *
 * Skips chapter-index cells (several JumpVTS_PTT to different PTTs) so scene
 * selection screens are not preferred over the real Play menu.
 */

'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';

import { dvdTimeToSeconds } from '../utils/dvdTime.js';
import { loadJsonFile } from '../utils/loadJson.js';
import {
  loadNavBySectorForBasename,
  pickHighlightNav,
  type NavPtsLike,
} from './menuStillSeek.js';
import {
  vmCmdBitString,
  vmCmdBytesOf,
  vmGetbits,
  type VmCmdBytes,
} from './vmCmdBits.js';

export type MainTitleInfo = {
  /** 1-based title number from VMG TT_SRPT (JumpTT argument). */
  titleNr: number;
  vts: number;
  vtsTtn: number;
  durationSec: number;
};

export type PlayTitleCellHit = {
  domain: number;
  cellID: number;
  vobID: number;
  reason: string;
  via:
    | 'JumpTT'
    | 'JumpVTS_TT'
    | 'JumpVTS_PTT'
    | 'LinkPGCN'
    | 'JumpSS_VMGM_PGC'
    | 'CallSS_VMGM_PGC';
};

type TitleSrptEntry = {
  title_set_nr?: number;
  vts_ttn?: number;
};

type CellAdr = {
  cell_id?: number;
  vob_id?: number;
  start_sector?: number;
  last_sector?: number;
};

type IfoLike = {
  tt_srpt?: { title?: TitleSrptEntry[] | null } | null;
  vts_pgcit?: {
    pgci_srp?: Array<{
      pgc?: {
        playback_time?: {
          hour?: number;
          minute?: number;
          second?: number;
          frame_u?: number;
        } | null;
        command_tbl?: {
          pre_cmds?: VmCmdBytes[];
          post_cmds?: VmCmdBytes[];
          cell_cmds?: VmCmdBytes[];
        } | null;
      } | null;
    } | null> | null;
  } | null;
  vts_ptt_srpt?: {
    title?: Array<{
      ptt?: Array<{ pgcn?: number }> | null;
    } | null> | null;
  } | null;
  pgci_ut?: {
    lu?: Array<{
      pgcit?: {
        pgci_srp?: Array<{
          pgc?: {
            command_tbl?: {
              pre_cmds?: VmCmdBytes[];
              post_cmds?: VmCmdBytes[];
              cell_cmds?: VmCmdBytes[];
            } | null;
          } | null;
        } | null> | null;
      } | null;
    } | null> | null;
  } | null;
  menu_c_adt?: {
    cell_adr_table?: CellAdr[] | null;
  } | null;
};

function domainBasename(domain: number): string {
  if (domain === 0) {
    return 'VIDEO_TS';
  }
  return 'VTS_' + String(domain).padStart(2, '0') + '_0';
}

function loadDomainIfo(webPath: string, domain: number): IfoLike | null {
  var file = path.join(webPath, domainBasename(domain) + '.json');
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return loadJsonFile(file) as IfoLike;
  } catch {
    return null;
  }
}

function listDomainIndexes(webPath: string): number[] {
  var out: number[] = [];
  try {
    var names = fs.readdirSync(webPath);
    for (var i = 0; i < names.length; i++) {
      var m = names[i].match(/^VTS_(\d+)_0\.json$/i);
      if (m) {
        out.push(parseInt(m[1], 10));
      }
    }
  } catch {
    return [0];
  }
  out.sort(function (a, b) {
    return a - b;
  });
  if (fs.existsSync(path.join(webPath, 'VIDEO_TS.json'))) {
    out.unshift(0);
  }
  return out;
}

/**
 * Longest title on the disc by summed IFO PGC playback_time over that
 * title's PTT PGC set (falls back to the VTS title PGC alone).
 */
export function findLongestTitle(webPath: string): MainTitleInfo | null {
  var vmg = loadDomainIfo(webPath, 0);
  var titles = vmg && vmg.tt_srpt && vmg.tt_srpt.title;
  if (!Array.isArray(titles) || !titles.length) {
    return null;
  }

  var best: MainTitleInfo | null = null;
  for (var i = 0; i < titles.length; i++) {
    var t = titles[i];
    var vts = (t && t.title_set_nr) | 0;
    var vtsTtn = (t && t.vts_ttn) | 0;
    if (!vts || !vtsTtn) {
      continue;
    }
    var vtsi = loadDomainIfo(webPath, vts);
    var dur = titleDurationSec(vtsi, vtsTtn);
    if (!best || dur > best.durationSec) {
      best = {
        titleNr: i + 1,
        vts: vts,
        vtsTtn: vtsTtn,
        durationSec: dur,
      };
    }
  }
  return best;
}

function titleDurationSec(vtsi: IfoLike | null, vtsTtn: number): number {
  if (!vtsi) {
    return 0;
  }
  var srps = vtsi.vts_pgcit && vtsi.vts_pgcit.pgci_srp;
  if (!Array.isArray(srps) || !srps.length) {
    return 0;
  }
  var pttTitle =
    vtsi.vts_ptt_srpt &&
    vtsi.vts_ptt_srpt.title &&
    vtsi.vts_ptt_srpt.title[vtsTtn - 1];
  var pgcs = new Set<number>();
  if (pttTitle && Array.isArray(pttTitle.ptt)) {
    for (var i = 0; i < pttTitle.ptt.length; i++) {
      var pgcn = (pttTitle.ptt[i] && pttTitle.ptt[i].pgcn) | 0;
      if (pgcn > 0) {
        pgcs.add(pgcn);
      }
    }
  }
  if (!pgcs.size && vtsTtn >= 1 && vtsTtn <= srps.length) {
    pgcs.add(vtsTtn);
  }
  var dur = 0;
  pgcs.forEach(function (pgcn) {
    var pgc = srps![pgcn - 1] && srps![pgcn - 1].pgc;
    dur += dvdTimeToSeconds(pgc && pgc.playback_time);
  });
  return dur;
}

type JumpKind =
  | 'JumpTT'
  | 'JumpVTS_TT'
  | 'JumpVTS_PTT'
  | 'LinkPGCN'
  | 'JumpSS_VMGM_PGC'
  | 'CallSS_VMGM_PGC'
  | null;

type ParsedCmd = {
  kind: JumpKind;
  /** JumpTT title / JumpVTS_* ttn / LinkPGCN pgc / JumpSS VMGM pgc */
  arg: number;
  /** JumpVTS_PTT chapter (1-based), else 0 */
  ptt: number;
};

/**
 * Optional Link after Set / SetSystem (command types 2–3).
 * Avatar “Play All” is Set GPRM + LinkPGCN — bare type-1 parse misses it.
 */
function parseOptionalLink(bits: string): ParsedCmd | null {
  // Same link opcode field as bare Link (bits 51..48).
  if (vmGetbits(bits, 51, 4) === 4) {
    return { kind: 'LinkPGCN', arg: vmGetbits(bits, 14, 15), ptt: 0 };
  }
  return null;
}

/** Exported for unit tests (Set+Link / Jump parsing). */
export function parsePlayCoverCmd(cmd: VmCmdBytes): ParsedCmd | null {
  return parseCmd(cmd);
}

function parseCmd(cmd: VmCmdBytes): ParsedCmd | null {
  var bytes = vmCmdBytesOf(cmd);
  var bits = vmCmdBitString(bytes);
  if (!bits) {
    return null;
  }
  var type = vmGetbits(bits, 63, 3);
  var bit60 = vmGetbits(bits, 60, 1);

  // Type 1: Jump/Call (bit60=1) or Link (bit60=0).
  if (type === 1) {
    if (bit60 === 1) {
      var jumpOp = vmGetbits(bits, 51, 4);
      if (jumpOp === 2) {
        return { kind: 'JumpTT', arg: vmGetbits(bits, 22, 7), ptt: 0 };
      }
      if (jumpOp === 3) {
        return { kind: 'JumpVTS_TT', arg: vmGetbits(bits, 22, 7), ptt: 0 };
      }
      if (jumpOp === 5) {
        return {
          kind: 'JumpVTS_PTT',
          arg: vmGetbits(bits, 22, 7),
          ptt: vmGetbits(bits, 41, 10),
        };
      }
      if (jumpOp === 6 || jumpOp === 8) {
        var ss = vmGetbits(bits, 23, 2);
        if (ss === 3) {
          return {
            kind: jumpOp === 6 ? 'JumpSS_VMGM_PGC' : 'CallSS_VMGM_PGC',
            arg: vmGetbits(bits, 46, 15),
            ptt: 0,
          };
        }
      }
      return null;
    }
    if (vmGetbits(bits, 51, 4) === 4) {
      return { kind: 'LinkPGCN', arg: vmGetbits(bits, 14, 15), ptt: 0 };
    }
    return null;
  }

  // Type 2 (Set System) / type 3 (Set GPRM): optional link when link-op ≠ 0.
  if ((type === 2 || type === 3) && vmGetbits(bits, 51, 4) !== 0) {
    return parseOptionalLink(bits);
  }
  return null;
}

function cmdJumpsToMainTitle(
  parsed: ParsedCmd,
  domain: number,
  main: MainTitleInfo,
): boolean {
  if (parsed.kind === 'JumpTT') {
    return parsed.arg === main.titleNr;
  }
  if (parsed.kind === 'JumpVTS_TT') {
    return domain === main.vts && parsed.arg === main.vtsTtn;
  }
  if (parsed.kind === 'JumpVTS_PTT') {
    return (
      domain === main.vts &&
      parsed.arg === main.vtsTtn &&
      parsed.ptt <= 1
    );
  }
  return false;
}

function eachMenuPgcCmd(
  ifo: IfoLike,
  visit: (pgcNr: number, parsed: ParsedCmd) => void,
): void {
  var lus = ifo.pgci_ut && ifo.pgci_ut.lu;
  if (!Array.isArray(lus)) {
    return;
  }
  for (var li = 0; li < lus.length; li++) {
    var srps = lus[li] && lus[li].pgcit && lus[li].pgcit!.pgci_srp;
    if (!Array.isArray(srps)) {
      continue;
    }
    for (var pi = 0; pi < srps.length; pi++) {
      var tbl = srps[pi] && srps[pi].pgc && srps[pi].pgc!.command_tbl;
      if (!tbl) {
        continue;
      }
      var sections = [tbl.pre_cmds, tbl.post_cmds, tbl.cell_cmds];
      for (var s = 0; s < sections.length; s++) {
        var cmds = sections[s];
        if (!Array.isArray(cmds)) {
          continue;
        }
        for (var c = 0; c < cmds.length; c++) {
          var parsed = parseCmd(cmds[c]);
          if (parsed && parsed.kind) {
            visit(pi + 1, parsed);
          }
        }
      }
    }
  }
}

/**
 * Menu PGC indexes (1-based) that eventually start the main title:
 *   - direct JumpTT / JumpVTS_* 
 *   - LinkPGCN → such a PGC (same domain)
 *   - JumpSS/CallSS VMGM_PGC → a VMGM play PGC (cross-domain trampoline)
 *
 * Fixed-point over hops so Avatar VTS “Play All” → LinkPGCN → JumpSS →
 * JumpTT is found.
 */
export function findDirectPlayMenuPgcs(
  ifo: IfoLike,
  domain: number,
  main: MainTitleInfo,
  vmgmPlayPgcs?: Set<number>,
): Set<number> {
  var out = new Set<number>();
  eachMenuPgcCmd(ifo, function (pgcNr, parsed) {
    if (cmdJumpsToMainTitle(parsed, domain, main)) {
      out.add(pgcNr);
    }
  });

  var vmgmPlay = vmgmPlayPgcs || new Set<number>();
  var changed = true;
  while (changed) {
    changed = false;
    eachMenuPgcCmd(ifo, function (pgcNr, parsed) {
      if (out.has(pgcNr)) {
        return;
      }
      if (parsed.kind === 'LinkPGCN' && out.has(parsed.arg)) {
        out.add(pgcNr);
        changed = true;
        return;
      }
      if (
        parsed.kind === 'JumpSS_VMGM_PGC' ||
        parsed.kind === 'CallSS_VMGM_PGC'
      ) {
        // Same-domain VMGM hop uses `out`; cross-domain uses caller’s vmgm set.
        if (
          (domain === 0 && out.has(parsed.arg)) ||
          vmgmPlay.has(parsed.arg)
        ) {
          out.add(pgcNr);
          changed = true;
        }
      }
    });
  }
  return out;
}

function btnitOf(nav: NavPtsLike): { btnNs: number; btnit: unknown[] } {
  var hl = nav.pci && nav.pci.hli;
  var btnNs = (hl && hl.hl_gi && hl.hl_gi.btn_ns) || 0;
  var btnit = (hl && hl.btnit) || [];
  return { btnNs: btnNs, btnit: Array.isArray(btnit) ? btnit : [] };
}

/**
 * True when the highlight looks like a chapter grid (several JumpVTS_PTT to
 * different chapters) — not the main Play button screen.
 */
export function isChapterIndexHighlight(nav: NavPtsLike): boolean {
  var info = btnitOf(nav);
  var ptts = new Set<number>();
  for (var j = 0; j < info.btnNs; j++) {
    var btn = info.btnit[j] as { cmd?: VmCmdBytes };
    var parsed = parseCmd(btn && btn.cmd);
    if (parsed && parsed.kind === 'JumpVTS_PTT' && parsed.ptt > 0) {
      ptts.add(parsed.ptt);
    }
  }
  return ptts.size >= 2;
}

/**
 * Scan converted web folder (IFO JSON + menu NAV sidecars) for cells that
 * start the longest title.
 */
export function findPlayTitleCoverCells(webPath: string): {
  main: MainTitleInfo | null;
  cells: PlayTitleCellHit[];
} {
  var main = findLongestTitle(webPath);
  if (!main) {
    return { main: null, cells: [] };
  }

  var domains = listDomainIndexes(webPath);
  var playPgcsByDomain = new Map<number, Set<number>>();

  // VMGM first — VTS menus often JumpSS into a VMGM JumpTT trampoline.
  var vmgIfo = loadDomainIfo(webPath, 0);
  var vmgmPlay = vmgIfo
    ? findDirectPlayMenuPgcs(vmgIfo, 0, main)
    : new Set<number>();
  playPgcsByDomain.set(0, vmgmPlay);

  for (var di = 0; di < domains.length; di++) {
    var d = domains[di];
    if (d === 0) {
      continue;
    }
    var ifo = loadDomainIfo(webPath, d);
    if (!ifo) {
      playPgcsByDomain.set(d, new Set());
      continue;
    }
    playPgcsByDomain.set(d, findDirectPlayMenuPgcs(ifo, d, main, vmgmPlay));
  }

  var byKey = new Map<string, PlayTitleCellHit>();

  for (var di2 = 0; di2 < domains.length; di2++) {
    var domain = domains[di2];
    var domainIfo = loadDomainIfo(webPath, domain);
    var table =
      domainIfo &&
      domainIfo.menu_c_adt &&
      domainIfo.menu_c_adt.cell_adr_table;
    if (!Array.isArray(table) || !table.length) {
      continue;
    }
    var basename = domainBasename(domain);
    var navBySector = loadNavBySectorForBasename(webPath, basename);
    var playPgcs = playPgcsByDomain.get(domain) || new Set<number>();

    for (var ci = 0; ci < table.length; ci++) {
      var cell = table[ci];
      var cellID = (cell && cell.cell_id) | 0;
      var vobID = (cell && cell.vob_id) | 0;
      var start = (cell && cell.start_sector) | 0;
      var last = (cell && cell.last_sector) | 0;
      if (!cellID || !vobID) {
        continue;
      }
      var highlight = pickHighlightNav(start, last, navBySector);
      if (!highlight || !highlight.nav) {
        continue;
      }
      var chapterIndex = isChapterIndexHighlight(highlight.nav);
      var info = btnitOf(highlight.nav);
      for (var j = 0; j < info.btnNs; j++) {
        var btn = info.btnit[j] as { cmd?: VmCmdBytes };
        var parsed = parseCmd(btn && btn.cmd);
        if (!parsed || !parsed.kind) {
          continue;
        }
        var via: PlayTitleCellHit['via'] | null = null;
        var detail = '';
        if (cmdJumpsToMainTitle(parsed, domain, main)) {
          if (parsed.kind === 'JumpVTS_PTT' && chapterIndex) {
            continue;
          }
          via = parsed.kind as PlayTitleCellHit['via'];
          detail = 'btn ' + j + ' ' + via;
        } else if (parsed.kind === 'LinkPGCN' && playPgcs.has(parsed.arg)) {
          via = 'LinkPGCN';
          detail = 'btn ' + j + ' LinkPGCN ' + parsed.arg;
        } else if (
          (parsed.kind === 'JumpSS_VMGM_PGC' ||
            parsed.kind === 'CallSS_VMGM_PGC') &&
          vmgmPlay.has(parsed.arg)
        ) {
          via = parsed.kind;
          detail = 'btn ' + j + ' ' + via + ' ' + parsed.arg;
        }
        if (!via) {
          continue;
        }
        var key = domain + ':' + cellID + ':' + vobID;
        if (byKey.has(key)) {
          continue;
        }
        byKey.set(key, {
          domain: domain,
          cellID: cellID,
          vobID: vobID,
          via: via,
          reason:
            'play title ' +
            main.titleNr +
            ' (longest, ' +
            Math.round(main.durationSec) +
            's) via ' +
            detail,
        });
      }
    }
  }

  return { main: main, cells: Array.from(byKey.values()) };
}
