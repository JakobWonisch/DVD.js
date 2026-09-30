// Generate a JavaScript file with translated VM programs.

'use strict';

import { loadJsonFile } from '../utils/loadJson.js';

import * as fs from 'node:fs';
import * as path from 'node:path';

import recompile from '../../vm/recompile.js';
import * as serverUtils from '../../server/utils/index.js';
import * as utils from '../../utils.js';
import { dvdTimeToSeconds } from '../../server/utils/dvdTime.js';
import { menuCellAdrCount } from './menuCellAdrCount.js';
import {
  loadNavBySectorForBasename,
  pickHighlightNav,
} from './menuStillSeek.js';

var toHex = utils.toHex;

export default generateJavaScript;

/**
 * Generate generateJavaScript code from IFO files pre/post commands.
 *
 * @param {string} dvdPath
 * @param {function} callback
 */
function generateJavaScript(dvdPath: string, callback) {
  process.stdout.write('\nGenerating JavaScript files:\n');

  var webPath = serverUtils.getWebPath(dvdPath);

  var ifoPath = getWebName('metadata');
  var filesList = loadJsonFile(ifoPath);
  var metadata = loadJsonFile(ifoPath);

  var pointer = 0;
  var currentVideoTitle = 1;
  var code = [
    "'use strict';",
    '',
    'var lang = "en";',
    'var domain = 0;',
    'var pgc = 0;',
    'var pgN = 1;',
    'var cellN = 1;',
    'var gprm = Array(16);',
    'var gprm_mode = Array(16);',
    'var rsm_cell = 0;',
    'var rsm_vtsN = 0;',
    'var rsm_pgcN = 0;',
    'var rsm_regs = [0, 0, 0, 0, 0];',
    // AUD_LANG / SPU_LANG are ISO-639 packed 16-bit codes (e.g. 0x656E = "en").
    'var sprm = {ASTN: 15, SPSTN: 62, AGLN: 1, TTN: 1, VTS_TTN: 1, TT_PGCN: 0, PTTN: 1, HL_BTNN: 1 * 0x400, NVTMR: 0, NV_PGCN: 0, AMXMD: 0, CC_PLT: 0, PLT: 15, MENU_LANG: 0x656E, VIDEO_CFG: 0, AUDIO_CFG: 0, AUD_LANG: 0x656E, AUD_EXT: 0, SPU_LANG: 0x656E, SPU_EXT: 0, PREF_REG: 0};',
    'var PGCIUT = [];',
    'var MPGCIUT = [];',
    'var btnCmd = [];',
    'var btnNav = [];',
    'var VTT_TABLE = {};',
    'var PTT_TABLE = {};',
    'var MENU_TYPES = [];',
    'var dummy = 0;',
    'var t = null; // Handler to setTimeout IDs.',
    'var stillTimer = null;',
    '',
    'for (var i = 0; i < 16; i++) {',
    '  gprm[i] = 0;',
    '  gprm_mode[i] = 0;',
    '}',
    '',
    'function saveRSM(cell) {',
    '  rsm_cell = (cell !== undefined && cell !== null && cell !== 0) ? cell : cellN;',
    '  rsm_vtsN = domain;',
    '  rsm_pgcN = pgc;',
    '  rsm_regs = [sprm["TTN"], sprm["VTS_TTN"], sprm["TT_PGCN"], sprm["PTTN"], sprm["HL_BTNN"]];',
    '}',
    '',
    'function resumeRSM() {',
    '  if (!rsm_vtsN) {',
    '    console.error("RSM without resume info");',
    '    if (typeof dvd !== "undefined" && dvd.onmenu) { dvd.onmenu({}); }',
    '    return 1;',
    '  }',
    '  cellN = rsm_cell || 1;',
    '  pgN = cellN;',
    '  domain = rsm_vtsN;',
    '  pgc = rsm_pgcN;',
    '  if (rsm_regs && rsm_regs.length === 5) {',
    '    sprm["TTN"] = rsm_regs[0];',
    '    sprm["VTS_TTN"] = rsm_regs[1];',
    '    sprm["TT_PGCN"] = rsm_regs[2];',
    '    sprm["PTTN"] = rsm_regs[3];',
    '    sprm["HL_BTNN"] = rsm_regs[4];',
    '  }',
    '  if (PGCIUT[domain] && PGCIUT[domain][pgc]) {',
    '    PGCIUT[domain][pgc].run();',
    '  } else if (typeof dvd !== "undefined") {',
    '    dvd.playByID("video-" + domain);',
    '  }',
    '  return 1;',
    '}',
    '',
    'function pickLang(domainIndex) {',
    '  var obj = MPGCIUT[domainIndex];',
    '  if (!obj) { return lang; }',
    '  var keys = Object.keys(obj).filter(function(k) { return obj[k] && typeof obj[k] === "object"; });',
    '  if (!keys.length) { return lang; }',
    '  var stored = null;',
    '  try {',
    '    stored = (typeof localStorage !== "undefined") ? localStorage.getItem("dvdjs.menuLang") : null;',
    '  } catch (e) {}',
    '  if (stored) { stored = String(stored).trim().toLowerCase(); }',
    '  if (stored && keys.indexOf(stored) >= 0) { return stored; }',
    '  if (keys.indexOf("en") >= 0) { return "en"; }',
    '  return keys[0];',
    '}',
    '',
    '// "menu" | "title" — LinkPGCN / Link*PGC target the active PGC space.',
    'var pgcSpace = "menu";',
    '',
    'function linkPGC(n) {',
    '  clearTimeout(t);',
    '  t = setTimeout(function() {',
    '    if (pgcSpace === "title") {',
    '      if (PGCIUT[domain] && PGCIUT[domain][n]) { PGCIUT[domain][n].run(); }',
    '      else { console.warn("DVD.js linkPGC: missing title PGC", domain, n); }',
    '      return;',
    '    }',
    '    if (MPGCIUT[domain] && MPGCIUT[domain][lang] && MPGCIUT[domain][lang][n]) {',
    '      MPGCIUT[domain][lang][n].run();',
    '    } else {',
    '      console.warn("DVD.js linkPGC: missing menu PGC", domain, lang, n);',
    '    }',
    '  });',
    '  return 1;',
    '}',
    '',
    'function currentPgcObject() {',
    '  if (pgcSpace === "title") {',
    '    return PGCIUT[domain] && PGCIUT[domain][pgc];',
    '  }',
    '  return MPGCIUT[domain] && MPGCIUT[domain][lang] && MPGCIUT[domain][lang][pgc];',
    '}',
    '',
    'function linkPGCField(field) {',
    '  var cur = currentPgcObject();',
    '  var n = cur && cur[field];',
    '  if (n) { return linkPGC(n); }',
    '  return 1;',
    '}',
    '',
    'function playCurrentMenuCell() {',
    '  // LinkPGN/CN/TopC are used in title *and* menu space (Shrek trivia',
    '  // answer clips LinkPGN inside title pre). Do not force menu space.',
    '  if (pgcSpace === "title") {',
    '    playCurrentTitleCell();',
    '    return;',
    '  }',
    '  pgcSpace = "menu";',
    '  // Menu cells are addressed as a flat 1-based list; LinkNextPG/PrevPG use',
    '  // pgN then copy to cellN. Keep them aligned when onPost (or LinkNextC)',
    '  // advances cellN alone — else the first LinkNextPG replays the same cell',
    '  // (Harry Potter Special Features → Cast & Crew).',
    '  pgN = cellN || 1;',
    '  var menu = MPGCIUT[domain] && MPGCIUT[domain][lang] && MPGCIUT[domain][lang][pgc];',
    '  if (!menu) { return; }',
    '  var cells = menu.cells || [];',
    '  var idx = cells.length ? Math.max(0, Math.min((cellN || 1) - 1, cells.length - 1)) : 0;',
    '  var cell = cells[idx] || {};',
    '  var menuId = "menu-" + lang + "-" + domain + "-" + pgc;',
    '  if (typeof dvd === "undefined" || !dvd || !dvd.playMenuCell) {',
    '    if (typeof dvd !== "undefined" && dvd && dvd.playMenuByID) { dvd.playMenuByID(menuId); }',
    '    return;',
    '  }',
    '  dvd.playMenuCell({',
    '    menuId: menuId,',
    '    domain: domain,',
    '    cellID: cell.cellID,',
    '    vobID: cell.vobID,',
    '    still_time: (cell.still_time != null ? cell.still_time : menu.still_time) || 0,',
    '    startSec: cell.startSec,',
    '    endSec: cell.endSec,',
    '    hli_s_ptm: cell.hli_s_ptm,',
    '    buttons: cell.buttons || [],',
    '    spuSelect: cell.spuSelect || [],',
    '    spuActivate: cell.spuActivate || [],',
    '    onPost: function() {',
    '      // DVD cell commands run after the cell finishes (play_Cell_post), not at PGC start.',
    '      var cmdNr = cell.cell_cmd_nr || 0;',
    '      if (cmdNr && menu.cellCmds && typeof menu.cellCmds[cmdNr - 1] === "function") {',
    '        if (menu.cellCmds[cmdNr - 1]()) { return; }',
    '      }',
    '      if ((cellN || 1) < cells.length) {',
    '        cellN = (cellN || 1) + 1;',
    '        pgN = cellN;',
    '        playCurrentMenuCell();',
    '        return;',
    '      }',
    '      if (menu.post) { menu.post(); }',
    '    }',
    '  });',
    '}',
    '',
    'function playCurrentTitleCell() {',
    '  pgcSpace = "title";',
    '  pgN = cellN || 1;',
    '  var title = PGCIUT[domain] && PGCIUT[domain][pgc];',
    '  if (!title) { return; }',
    '  var cells = title.cells || [];',
    '  var idx = cells.length ? Math.max(0, Math.min((cellN || 1) - 1, cells.length - 1)) : 0;',
    '  var cell = cells[idx] || {};',
    '  if (typeof dvd === "undefined" || !dvd || typeof dvd.playTitleCell !== "function") {',
    '    if (typeof dvd !== "undefined" && dvd && typeof dvd.playTitlePgc === "function") {',
    '      dvd.playTitlePgc(domain, pgc);',
    '    } else if (typeof dvd !== "undefined" && dvd && dvd.playByID) {',
    '      dvd.playByID("video-" + domain);',
    '    }',
    '    return;',
    '  }',
    '  dvd.playTitleCell({',
    '    domain: domain,',
    '    pgc: pgc,',
    '    cellN: cellN || 1,',
    '    cellID: cell.cellID,',
    '    vobID: cell.vobID,',
    '    still_time: cell.still_time || 0,',
    '    startSec: cell.startSec,',
    '    endSec: cell.endSec,',
    '    onPost: function() {',
    '      var cmdNr = cell.cell_cmd_nr || 0;',
    '      if (cmdNr && title.cellCmds && typeof title.cellCmds[cmdNr - 1] === "function") {',
    '        if (title.cellCmds[cmdNr - 1]()) { return; }',
    '      }',
    '      if (cells.length && (cellN || 1) < cells.length) {',
    '        cellN = (cellN || 1) + 1;',
    '        pgN = cellN;',
    '        playCurrentTitleCell();',
    '        return;',
    '      }',
    '      if (title.post) { title.post(); }',
    '    }',
    '  });',
    '}',
  ];

  next(filesList[pointer] && filesList[pointer].ifo);

  function next(ifoFile: string) {
    if (!ifoFile) {
      pointer++;
      if (pointer < filesList.length) {
        setTimeout(function () {
          next(filesList[pointer] && filesList[pointer].ifo);
        }, 0);
      } else {
        code = addEventListener(null, code);

        fs.writeFile(path.join(webPath, 'vm.js'), code.join('\n'), function (err) {
          if (err) {
            console.error(err);
          }

          process.stdout.write('.');

          callback();
        });
      }
      return;
    }

    ifoFile = path.join(webPath, '../', ifoFile);
    var name = path.basename(ifoFile);
    var basename = path.basename(name, '.json');
    var json = loadJsonFile(ifoFile);

    code = first_play_pgc(json, code);
    code = pgciut(json, code);
    code = pgci_srp(json, code);
    code = btn_cmd(json, code);
    code = title_stub_btn_cmd(code);
    code = vtt_table(json, code);
    code = ptt_table(json, code);
    code = menu_type_table(json, code);

    pointer++;
    if (pointer < filesList.length) {
      setTimeout(function () {
        next(filesList[pointer] && filesList[pointer].ifo);
      }, 0);
    } else {
      code = addEventListener(json, code);

      fs.writeFile(path.join(webPath, 'vm.js'), code.join('\n'), function (err) {
        if (err) {
          console.error(err);
        }

        process.stdout.write('.');

        callback();
      });
    }

    /** Compile each PGC cell_cmds entry to its own function (indexed by cell_cmd_nr). */
    function compileCellCmds(cellCmds) {
      if (!cellCmds || !cellCmds.length) {
        return '[]';
      }
      return (
        '[' +
        cellCmds
          .map(function (cmd) {
            return 'function() {' + recompile([cmd]) + '}';
          })
          .join(',') +
        ']'
      );
    }

    function first_play_pgc(json, code) {
      if (!json.first_play_pgc || !json.first_play_pgc.command_tbl.nr_of_pre) {
        console.log('No First Play PGC present');
        return code;
      }

      code = code.concat([
        '',
        '// First Play PGC',
        'function fp_pgc() {',
        '  setTimeout(function() {' +
          recompile(json.first_play_pgc.command_tbl.pre_cmds) +
          '}, 500);',
        '}',
      ]);
      return code;
    }

    function pgciut(json, code) {
      if (
        !json.vts_pgcit ||
        !json.vts_pgcit.pgci_srp ||
        !Array.isArray(json.vts_pgcit.pgci_srp)
      ) {
        console.log('No Menu PGCI Unit table present');
        return code;
      }
      var index = pointer;

      code = code.concat(['', 'PGCIUT[' + index + '] = [];']);

      for (var j = 0; j < json.vts_pgcit.nr_of_pgci_srp; j++) {
        var pgci_srp = json.vts_pgcit.pgci_srp[j];
        var pgcIndex = j + 1;
        // Emit even when command_tbl is null — titles may still be JumpTT targets.
        if (pgci_srp.pgc) {
          var titleCmds = pgci_srp.pgc.command_tbl;
          var titleCellsJs = buildTitleCells(
            pgci_srp.pgc,
            ((metadata && metadata[index]) || {}).titlePgcMedia,
            pgcIndex,
          );
          code = code.concat([
            'PGCIUT[' + index + '][' + pgcIndex + '] = {',
            'run: function() {',
            '  pgcSpace = "title";',
            '  domain = ' + index + ';',
            '  pgc = ' + pgcIndex + ';',
            '  cellN = 1;',
            '  pgN = 1;',
            '  console.debug("Run: Domain:", domain, "Lang:", lang, "PGC:", pgc);',
            '  if(this.pre()){return;}',
            '  if (typeof dvd !== "undefined" && dvd && typeof dvd.playTitlePgc === "function") {',
            '    dvd.playTitlePgc(domain, pgc);',
            '  } else {',
            '    dvd.playByID("video-' + index + '");',
            '  }',
            '},',
            'pre: function() {' +
              recompile(titleCmds && titleCmds.pre_cmds) +
              '},',
            'post: function() {' +
              recompile(titleCmds && titleCmds.post_cmds) +
              '},',
            'cells: ' + JSON.stringify(titleCellsJs) + ',',
            'cellCmds: ' + compileCellCmds(titleCmds && titleCmds.cell_cmds),
            '};',
          ]);
        }
      }
      return code;
    }

    /**
     * Title-domain cells for LinkPGN/CN — prefer remapped WebM windows from
     * titlePgcMedia.pgcCells (encode), else IFO durations (vm-only fallback).
     */
    function buildTitleCells(pgc, titlePgcMedia, pgcIndex) {
      var fromMedia =
        titlePgcMedia &&
        titlePgcMedia.pgcCells &&
        titlePgcMedia.pgcCells[String(pgcIndex)];
      if (Array.isArray(fromMedia) && fromMedia.length) {
        return fromMedia.map(function (cell) {
          return {
            cellID: cell.cellID,
            vobID: cell.vobID,
            still_time: cell.still_time || 0,
            startSec: cell.startSec,
            endSec: cell.endSec,
            cell_cmd_nr: cell.cell_cmd_nr || 0,
          };
        });
      }
      var source = [];
      var t = 0;
      var timeline =
        titlePgcMedia &&
        titlePgcMedia.pgcTimeline &&
        titlePgcMedia.pgcTimeline[String(pgcIndex)];
      if (timeline && Number.isFinite(timeline.startSec)) {
        t = timeline.startSec;
      }
      if (pgc && pgc.cell_position) {
        for (var c = 0; c < pgc.cell_position.length; c++) {
          var pos = pgc.cell_position[c];
          var playback = pgc.cell_playback && pgc.cell_playback[c];
          var duration = playback
            ? dvdTimeToSeconds(playback.playback_time)
            : 0;
          source.push({
            cellID: pos.cell_nr,
            vobID: pos.vob_id_nr,
            still_time: playback ? playback.still_time || 0 : 0,
            startSec: t,
            endSec: t + duration,
            cell_cmd_nr: playback ? playback.cell_cmd_nr || 0 : 0,
          });
          t += duration;
        }
      }
      return source;
    }

    function pgci_srp(json, code) {
      if (!json.pgci_ut || !json.pgci_ut.lu || !Array.isArray(json.pgci_ut.lu)) {
        console.log('No Menu PGCI Unit table present');
        return code;
      }
      var index = pointer;
      var domainMeta = (metadata && metadata[index]) || {};

      code = code.concat(['', 'MPGCIUT[' + index + '] = [];']);

      for (var i = 0; i < json.pgci_ut.nr_of_lus; i++) {
        var lu = json.pgci_ut.lu[i];
        var langCode = utils.ifoMenuLangCode(lu.lang_code);
        code.push('MPGCIUT[' + index + '].' + langCode + ' = {};');
        for (var j = 0; j < lu.pgcit.nr_of_pgci_srp; j++) {
          var pgci_srp = lu.pgcit.pgci_srp[j];
          var pgcIndex = j + 1;
          // Emit even when command_tbl is null — interactive menus often have
          // only PCI button commands (LOTR Specials destinations, etc.).
          if (pgci_srp.pgc) {
            var menuCmds = pgci_srp.pgc.command_tbl;
            var cellsJs = buildMenuCells(
              pgci_srp.pgc,
              domainMeta.menuCell || {},
              domainMeta.menu && domainMeta.menu[langCode],
              pgcIndex
            );

            code = code.concat([
              'MPGCIUT[' + index + '].' + langCode + '[' + pgcIndex + '] = {',
              'run: function() {',
              '  pgcSpace = "menu";',
              '  domain = ' + index + ';',
              '  pgc = ' + pgcIndex + ';',
              // Keep an explicit/session lang when this domain has that LU;
              // only re-pick when missing (init / cross-domain fallback).
              '  if (!(MPGCIUT[' + index + '] && MPGCIUT[' + index + '][lang])) {',
              '    lang = pickLang(' + index + ') || lang;',
              '  }',
              '  cellN = 1;',
              '  pgN = 1;',
              '  console.debug("Run: Domain:", domain, "Lang:", lang, "PGC:", pgc);',
              '  if(this.pre()){return;}',
              '  playCurrentMenuCell();',
              '},',
              'next_pgc: ' + (pgci_srp.pgc.next_pgc_nr || 0) + ',',
              'prev_pgc: ' + (pgci_srp.pgc.prev_pgc_nr || 0) + ',',
              'goup_pgc: ' + (pgci_srp.pgc.goup_pgc_nr || 0) + ',',
              'still_time: ' + (pgci_srp.pgc.still_time || 0) + ',',
              'cells: ' + JSON.stringify(cellsJs) + ',',
              'pre: function() {' +
                recompile(menuCmds && menuCmds.pre_cmds) +
                '},',
              'post: function() {' +
                recompile(menuCmds && menuCmds.post_cmds) +
                '},',
              'cellCmds: ' + compileCellCmds(menuCmds && menuCmds.cell_cmds),
              '};',
            ]);
          }
        }
      }
      return code;

      function buildMenuCells(pgc, menuCellTable, menusForLang, pgcIndex) {
        var fromMeta = null;
        if (Array.isArray(menusForLang)) {
          for (var m = 0; m < menusForLang.length; m++) {
            if (menusForLang[m].pgc === pgcIndex && menusForLang[m].cells) {
              fromMeta = menusForLang[m].cells;
              break;
            }
          }
        }

        var source = fromMeta;
        if (!source || !source.length) {
          source = [];
          var t = 0;
          if (pgc.cell_position) {
            for (var c = 0; c < pgc.cell_position.length; c++) {
              var pos = pgc.cell_position[c];
              var playback = pgc.cell_playback && pgc.cell_playback[c];
              var duration = playback
                ? dvdTimeToSeconds(playback.playback_time)
                : 0;
              source.push({
                cellID: pos.cell_nr,
                vobID: pos.vob_id_nr,
                still_time: playback ? playback.still_time : 0,
                startSec: t,
                endSec: t + duration,
              });
              t += duration;
            }
          }
        }

        return source.map(function (cell, cIdx) {
          var menuCell =
            menuCellTable[String(cell.cellID)] &&
            menuCellTable[String(cell.cellID)][String(cell.vobID)];
          var playback = pgc.cell_playback && pgc.cell_playback[cIdx];
          return {
            cellID: cell.cellID,
            vobID: cell.vobID,
            still_time:
              cell.still_time != null
                ? cell.still_time
                : menuCell && menuCell.still_time,
            // Prefer file-absolute times from menuCell over PGC-relative cells.
            startSec:
              menuCell && menuCell.startSec != null
                ? menuCell.startSec
                : cell.startSec,
            endSec:
              menuCell && menuCell.endSec != null
                ? menuCell.endSec
                : cell.endSec,
            hli_s_ptm: menuCell && menuCell.hli_s_ptm,
            cell_cmd_nr: playback ? playback.cell_cmd_nr || 0 : 0,
            buttons: (menuCell && menuCell.buttons) || [],
            spuSelect: (menuCell && menuCell.spuSelect) || [],
            spuActivate: (menuCell && menuCell.spuActivate) || [],
          };
        });
      }
    }

    function btn_cmd(json, code) {
      var cellCount = menuCellAdrCount(json.menu_c_adt);
      if (!cellCount) {
        return code;
      }

      var navBySector = loadNavBySectorForBasename(webPath, basename);

      code.push('btnCmd[' + pointer + '] = [];');
      code.push('btnNav[' + pointer + '] = [];');

      for (var i = 0; i < cellCount; i++) {
        var vobPointer = json.menu_c_adt.cell_adr_table[i].vob_id;
        var cellId = json.menu_c_adt.cell_adr_table[i].cell_id;
        var vob = json.menu_c_adt.cell_adr_table[i];

        var highlight = pickHighlightNav(
          vob.start_sector,
          vob.last_sector,
          navBySector,
        );
        var pci = highlight && highlight.nav && highlight.nav.pci;
        var btnNs =
          pci && pci.hli && pci.hli.hl_gi ? pci.hli.hl_gi.btn_ns || 0 : 0;

        // Skip empty-HLI cells (VMGM lead-in). Index by vob_id AND cell_id —
        // Harry Potter (and similar) reuse one vob_id across cells with
        // different button sets; a vob-only key overwrites Main Menu etc.
        if (!btnNs || !pci || !pci.hli || !pci.hli.btnit) {
          continue;
        }

        code.push(
          'btnCmd[' +
            pointer +
            '][' +
            vobPointer +
            '] = btnCmd[' +
            pointer +
            '][' +
            vobPointer +
            '] || [];'
        );
        code.push(
          'btnNav[' +
            pointer +
            '][' +
            vobPointer +
            '] = btnNav[' +
            pointer +
            '][' +
            vobPointer +
            '] || [];'
        );
        code.push(
          'btnCmd[' + pointer + '][' + vobPointer + '][' + cellId + '] = [];'
        );
        code.push(
          'btnNav[' + pointer + '][' + vobPointer + '][' + cellId + '] = [];'
        );
        for (var j = 0; j < btnNs; j++) {
          var cmd = (pci.hli.btnit[j] as { cmd: number[] | object }).cmd;
          var btn = pci.hli.btnit[j] as {
            up?: number;
            down?: number;
            left?: number;
            right?: number;
            auto_action_mode?: number;
          };
          code.push(
            'btnCmd[' +
              pointer +
              '][' +
              vobPointer +
              '][' +
              cellId +
              '][' +
              j +
              '] = function() {domain = ' +
              pointer +
              ';' +
              recompile([cmd as any]) +
              '};'
          );
          code.push(
            'btnNav[' +
              pointer +
              '][' +
              vobPointer +
              '][' +
              cellId +
              '][' +
              j +
              '] = ' +
              JSON.stringify({
                up: btn.up || 0,
                down: btn.down || 0,
                left: btn.left || 0,
                right: btn.right || 0,
                auto_action_mode: btn.auto_action_mode || 0,
              }) +
              ';'
          );
        }
      }

      return code;
    }

    /**
     * Interactive title stubs: emit btnCmd/btnNav from stub metadata so D-pad /
     * clicks work without title NAV sidecars.
     */
    function title_stub_btn_cmd(code) {
      var domainMeta = (metadata && metadata[pointer]) || {};
      var stubs =
        domainMeta.titlePgcMedia && domainMeta.titlePgcMedia.stubs
          ? domainMeta.titlePgcMedia.stubs
          : null;
      if (!stubs) {
        return code;
      }
      var keys = Object.keys(stubs);
      var emitted = false;
      for (var ki = 0; ki < keys.length; ki++) {
        var stub = stubs[keys[ki]];
        if (
          !stub ||
          stub.kind !== 'interactive' ||
          !stub.buttons ||
          !stub.buttons.length ||
          stub.cellID == null ||
          stub.vobID == null
        ) {
          continue;
        }
        if (!emitted) {
          code.push('btnCmd[' + pointer + '] = btnCmd[' + pointer + '] || [];');
          code.push('btnNav[' + pointer + '] = btnNav[' + pointer + '] || [];');
          emitted = true;
        }
        var vobId = stub.vobID;
        var cellId = stub.cellID;
        code.push(
          'btnCmd[' +
            pointer +
            '][' +
            vobId +
            '] = btnCmd[' +
            pointer +
            '][' +
            vobId +
            '] || [];',
        );
        code.push(
          'btnNav[' +
            pointer +
            '][' +
            vobId +
            '] = btnNav[' +
            pointer +
            '][' +
            vobId +
            '] || [];',
        );
        code.push(
          'btnCmd[' + pointer + '][' + vobId + '][' + cellId + '] = [];',
        );
        code.push(
          'btnNav[' + pointer + '][' + vobId + '][' + cellId + '] = [];',
        );
        for (var j = 0; j < stub.buttons.length; j++) {
          var btn = stub.buttons[j] as {
            id?: number;
            up?: number;
            down?: number;
            left?: number;
            right?: number;
            auto_action_mode?: number;
            cmdBytes?: number[];
          };
          var cmdBytes =
            btn && Array.isArray(btn.cmdBytes) ? btn.cmdBytes : [];
          var cmdObj = { bytes: cmdBytes };
          code.push(
            'btnCmd[' +
              pointer +
              '][' +
              vobId +
              '][' +
              cellId +
              '][' +
              j +
              '] = function() {domain = ' +
              pointer +
              ';' +
              recompile([cmdObj as any]) +
              '};',
          );
          code.push(
            'btnNav[' +
              pointer +
              '][' +
              vobId +
              '][' +
              cellId +
              '][' +
              j +
              '] = ' +
              JSON.stringify({
                up: (btn && btn.up) || 0,
                down: (btn && btn.down) || 0,
                left: (btn && btn.left) || 0,
                right: (btn && btn.right) || 0,
                auto_action_mode: (btn && btn.auto_action_mode) || 0,
              }) +
              ';',
          );
        }
      }
      return code;
    }

    function vtt_table(json, code) {
      if (
        !json.vts_pgcit ||
        !json.vts_pgcit.pgci_srp ||
        !Array.isArray(json.vts_pgcit.pgci_srp)
      ) {
        console.log('No PGCI Unit table present');
        return code;
      }
      var domainIndex = pointer;

      for (var i = 0; i < json.vts_pgcit.nr_of_pgci_srp; i++) {
        var pgci_srp = json.vts_pgcit.pgci_srp[i];
        var pgcIndex = i + 1;
        if (pgci_srp.pgc) {
          code.push(
            'VTT_TABLE[' +
              currentVideoTitle +
              '] = {domain: ' +
              domainIndex +
              ', pgc: ' +
              pgcIndex +
              '};'
          );
        }
        currentVideoTitle++;
      }

      return code;
    }

    function ptt_table(json, code) {
      if (
        !json.vts_pgcit ||
        !json.vts_pgcit.pgci_srp ||
        !Array.isArray(json.vts_pgcit.pgci_srp)
      ) {
        console.log('No PGCI Unit table present');
        return code;
      }
      var domainIndex = pointer;
      var vtsIndex = 1;
      var chapterIndex = 1;

      code.push('PTT_TABLE[' + domainIndex + '] = {};');

      for (var i = 0; i < json.vts_pgcit.nr_of_pgci_srp; i++) {
        var pgci_srp = json.vts_pgcit.pgci_srp[i];
        var pgcIndex = i + 1;
        var pttIndex = 0;
        code.push(
          'PTT_TABLE[' + domainIndex + '][' + vtsIndex + '] = [];'
        );

        for (var j = 0; j < pgci_srp.pgc.nr_of_programs; j++) {
          code.push(
            'PTT_TABLE[' +
              domainIndex +
              '][' +
              vtsIndex +
              '][' +
              pttIndex +
              '] = {domain: ' +
              domainIndex +
              ', pgc: ' +
              pgcIndex +
              ', chapter: ' +
              chapterIndex +
              '};'
          );
          pttIndex++;
          chapterIndex++;
        }
        vtsIndex++;
      }

      return code;
    }

    function menu_type_table(json, code) {
      if (!json.pgci_ut || !json.pgci_ut.lu || !Array.isArray(json.pgci_ut.lu)) {
        console.log('No Menu PGCI Unit table present');
        return code;
      }
      var domainIndex = pointer;

      code.push('MENU_TYPES[' + domainIndex + '] = {};');

      for (var i = 0; i < json.pgci_ut.nr_of_lus; i++) {
        var lu = json.pgci_ut.lu[i];
        var langCode = utils.ifoMenuLangCode(lu.lang_code);
        code.push('MENU_TYPES[' + domainIndex + '].' + langCode + ' = [];');

        for (var j = 0; j < lu.pgcit.nr_of_pgci_srp; j++) {
          var pgci_srp = lu.pgcit.pgci_srp[j];
          var pgcIndex = j + 1;
          var menuType = pgci_srp.entry_id & 0x0f;
          var menuName = ifo_print_menu_name(menuType);
          if (menuType === 0) {
            continue;
          }
          if (pgci_srp.pgc) {
            code.push(
              'MENU_TYPES[' +
                domainIndex +
                '].' +
                langCode +
                '[' +
                menuType +
                ' /* ' +
                menuName +
                ' */] = {' +
                'domain: ' +
                domainIndex +
                ', ' +
                'lang: "' +
                langCode +
                '", ' +
                'pgc: ' +
                pgcIndex +
                '};'
            );
          }
        }
      }

      return code;

      function ifo_print_menu_name(type) {
        switch (type) {
          case 2:
            return 'Title';
          case 3:
            return 'Root';
          case 4:
            return 'Sub-Picture';
          case 5:
            return 'Audio';
          case 6:
            return 'Angle';
          case 7:
            return 'PTT (Chapter)';
          default:
            return 'Unknown';
        }
      }
    }

    function addEventListener(json, code) {
      code = code.concat([
        // Idempotent: loadVm + startVm both used to call init(); stacking
        // click handlers made the second see a detached button (parentNode
        // null) after the first already ran btnCmd and rebuilt the menu.
        // Guard typeof dvd — dispose must not delete window.dvd (ReferenceError).
        'function init() {',
        '  lang = pickLang(0) || lang;',
        '  if (typeof dvd === "undefined" || !dvd) {',
        '    console.error("DVD.js init: window.dvd is not bound");',
        '    return;',
        '  }',
        '  if (dvd._dvdjsVmInited) { return; }',
        '  dvd._dvdjsVmInited = true;',
        '',
        '  dvd.addEventListener(\'click\', function(event) {',
        '    event.stopImmediatePropagation();',
        '    var target = event.target;',
        '    var menu = target && target.parentNode;',
        '    if (!menu || !menu.dataset) { return; }',
        '    var domain = menu.dataset.domain;',
        '    var vob = menu.dataset.vob;',
        '    var cell = menu.dataset.cell;',
        '    var id = target.dataset && target.dataset.id;',
        '',
        '    sprm["HL_BTNN"] = (parseInt(id, 10) + 1) * 0x0400;',
        '',
        '    if (target.tagName !== \'INPUT\' || domain === undefined || vob === undefined || cell === undefined || id === undefined) {',
        '      return;',
        '    }',
        '',
        '    if (dvd.setMenuHighlight) { dvd.setMenuHighlight(menu, parseInt(id, 10)); }',
        '    if (dvd.flashMenuActivate) { dvd.flashMenuActivate(menu, parseInt(id, 10)); }',
        '',
        '    var cmd = btnCmd[domain] && btnCmd[domain][vob] && btnCmd[domain][vob][cell] && btnCmd[domain][vob][cell][id];',
        '    if (!cmd) {',
        '      console.error(\'Missing button command for\', domain, vob, cell, id);',
        '      return;',
        '    }',
        '',
        '    console.debug("Button: Domain:", domain, "Vob:", vob, "Cell:", cell, "Id:", id, "Cmd:", cmd);',
        '    if (dvd.beginUserButtonNav) { dvd.beginUserButtonNav(); } else { dvd._dvdjsFromButton = true; }',
        '    cmd();',
        '  });',
        '',
        '  function onDvdKeyDown(event) {',
        '    if (typeof dvd === "undefined" || !dvd) { return; }',
        '    var menu = dvd._dvdjsActiveMenu || null;',
        '    if (!menu || menu.hidden || (menu.style && menu.style.display === \'none\')) {',
        '      menu = null;',
        '      var menus = dvd.querySelectorAll(\'x-menu\');',
        '      for (var mi = 0; mi < menus.length; mi++) {',
        '        var cand = menus[mi];',
        '        var disp = (cand.style && cand.style.display) || "";',
        '        if (cand.hidden || disp === \'none\') { continue; }',
        '        if (disp === \'flex\' || disp === \'block\' || cand.offsetParent !== null) {',
        '          menu = cand;',
        '          break;',
        '        }',
        '      }',
        '    }',
        '    if (!menu) { return; }',
        '    var domain = menu.dataset.domain;',
        '    var vob = menu.dataset.vob;',
        '    var cell = menu.dataset.cell;',
        '    if (domain === undefined || vob === undefined || cell === undefined) { return; }',
        '    var nav = btnNav[domain] && btnNav[domain][vob] && btnNav[domain][vob][cell];',
        '    if (!nav || !nav.length) { return; }',
        '',
        '    var current = Math.floor((sprm["HL_BTNN"] || 0x0400) / 0x0400);',
        '    if (current < 1) { current = 1; }',
        '    var idx = current - 1;',
        '    if (idx < 0 || idx >= nav.length) { idx = 0; current = 1; }',
        '    var entry = nav[idx];',
        '    if (!entry) { return; }',
        '',
        '    var nextId = null;',
        '    if (event.key === \'ArrowUp\') { nextId = entry.up; }',
        '    else if (event.key === \'ArrowDown\') { nextId = entry.down; }',
        '    else if (event.key === \'ArrowLeft\') { nextId = entry.left; }',
        '    else if (event.key === \'ArrowRight\') { nextId = entry.right; }',
        '    else if (event.key === \'Enter\') {',
        '      event.preventDefault();',
        '      if (dvd.setMenuHighlight) { dvd.setMenuHighlight(menu, idx); }',
        '      if (dvd.flashMenuActivate) { dvd.flashMenuActivate(menu, idx); }',
        '      if (btnCmd[domain] && btnCmd[domain][vob] && btnCmd[domain][vob][cell] && btnCmd[domain][vob][cell][idx]) {',
        '        if (dvd.beginUserButtonNav) { dvd.beginUserButtonNav(); } else { dvd._dvdjsFromButton = true; }',
        '        btnCmd[domain][vob][cell][idx]();',
        '      }',
        '      return;',
        '    } else { return; }',
        '',
        '    if (!nextId) { return; }',
        '    event.preventDefault();',
        '    sprm["HL_BTNN"] = nextId * 0x0400;',
        '    if (dvd.setMenuHighlight) { dvd.setMenuHighlight(menu, nextId - 1); }',
        '    var nextEntry = nav[nextId - 1];',
        '    if (nextEntry && nextEntry.auto_action_mode && btnCmd[domain] && btnCmd[domain][vob] && btnCmd[domain][vob][cell] && btnCmd[domain][vob][cell][nextId - 1]) {',
        '      if (dvd.beginUserButtonNav) { dvd.beginUserButtonNav(); } else { dvd._dvdjsFromButton = true; }',
        '      btnCmd[domain][vob][cell][nextId - 1]();',
        '    }',
        '  }',
        '  dvd._dvdjsKeyHandler = onDvdKeyDown;',
        '  document.addEventListener(\'keydown\', onDvdKeyDown);',
        '',
        '  dvd.onmenu = function(event) {',
        '    lang = pickLang(domain) || pickLang(0) || lang;',
        '    var menu = null;',
        '    var domainMenus = MENU_TYPES[domain] && MENU_TYPES[domain][lang];',
        '    var vmgmMenus = MENU_TYPES[0] && MENU_TYPES[0][lang];',
        '    function isStub(m) {',
        '      if (!m || !MPGCIUT[m.domain] || !MPGCIUT[m.domain][m.lang]) { return true; }',
        '      var p = MPGCIUT[m.domain][m.lang][m.pgc];',
        '      return !p || !p.cells || !p.cells.length;',
        '    }',
        '    // Prefer a non-stub VTS Root; Avatar domain-5 Root JumpTTs into missing titles.',
        '    if (domainMenus && domainMenus[3 /* Root */] && !isStub(domainMenus[3])) {',
        '      menu = domainMenus[3 /* Root */];',
        '    } else if (vmgmMenus && vmgmMenus[2 /* Title */]) {',
        '      menu = vmgmMenus[2 /* Title */];',
        '    } else if (domainMenus && domainMenus[3 /* Root */]) {',
        '      menu = domainMenus[3 /* Root */];',
        '    }',
        '',
        '    if (menu) {',
        '      console.log(menu);',
        '      MPGCIUT[menu.domain][menu.lang][menu.pgc].run();',
        '    }',
        '  };',
        '}',
        '',
      ]);

      return code;
    }
  }

  function getWebName(name: string): string {
    return path.join(webPath, getJsonFileName(name));
  }
}

function getJsonFileName(name: string): string {
  return name.replace(/\.IFO$/i, '') + '.json';
}
