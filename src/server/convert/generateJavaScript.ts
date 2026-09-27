// Generate a JavaScript file with translated VM programs.

'use strict';

import { loadJsonFile } from '../utils/loadJson.js';

import * as fs from 'node:fs';
import * as path from 'node:path';

import recompile from '../../vm/recompile.js';
import * as serverUtils from '../../server/utils/index.js';
import * as utils from '../../utils.js';
import { dvdTimeToSeconds } from '../../server/utils/dvdTime.js';

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
    'var sprm = {ASTN: 15, SPSTN: 62, AGLN: 1, TTN: 1, VTS_TTN: 1, TT_PGCN: 0, PTTN: 1, HL_BTNN: 1 * 0x400, NVTMR: 0, NV_PGCN: 0, AMXMD: 0, CC_PLT: 0, PLT: 15};',
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
    '  var pref = (typeof navigator !== "undefined" && navigator.language) ? navigator.language.slice(0, 2).toLowerCase() : "en";',
    '  if (keys.indexOf(pref) >= 0) { return pref; }',
    '  if (keys.indexOf("en") >= 0) { return "en"; }',
    '  return keys[0];',
    '}',
    '',
    'function playCurrentMenuCell() {',
    '  var menu = MPGCIUT[domain] && MPGCIUT[domain][lang] && MPGCIUT[domain][lang][pgc];',
    '  if (!menu) { return; }',
    '  var cells = menu.cells || [];',
    '  var idx = cells.length ? Math.max(0, Math.min((cellN || 1) - 1, cells.length - 1)) : 0;',
    '  var cell = cells[idx] || {};',
    '  var menuId = "menu-" + lang + "-" + domain + "-" + pgc;',
    '  if (typeof dvd === "undefined" || !dvd.playMenuCell) {',
    '    if (dvd && dvd.playMenuByID) { dvd.playMenuByID(menuId); }',
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
    '    onPost: function() { if (menu.post) { menu.post(); } }',
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
        if (pgci_srp.pgc && pgci_srp.pgc.command_tbl) {
          code = code.concat([
            'PGCIUT[' + index + '][' + pgcIndex + '] = {',
            'run: function() {',
            '  domain = ' + index + ';',
            '  pgc = ' + pgcIndex + ';',
            '  console.log(domain, lang, pgc); // DEBUG',
            '  if(this.pre()){return;}',
            '  dvd.playByID("video-' + index + '");',
            '  if(this.cell()){return;}',
            '},',
            'pre: function() {' +
              recompile(pgci_srp.pgc.command_tbl.pre_cmds) +
              '},',
            'post: function() {' +
              recompile(pgci_srp.pgc.command_tbl.post_cmds) +
              '},',
            'cell: function() {' +
              recompile(pgci_srp.pgc.command_tbl.cell_cmds) +
              '}',
            '};',
          ]);
        }
      }
      return code;
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
        var langCode = utils.bit2str(lu.lang_code);
        code.push('MPGCIUT[' + index + '].' + langCode + ' = {};');
        for (var j = 0; j < lu.pgcit.nr_of_pgci_srp; j++) {
          var pgci_srp = lu.pgcit.pgci_srp[j];
          var pgcIndex = j + 1;
          if (pgci_srp.pgc && pgci_srp.pgc.command_tbl) {
            var cellsJs = buildMenuCells(
              pgci_srp.pgc,
              domainMeta.menuCell || {},
              domainMeta.menu && domainMeta.menu[langCode],
              pgcIndex
            );

            code = code.concat([
              'MPGCIUT[' + index + '].' + langCode + '[' + pgcIndex + '] = {',
              'run: function() {',
              '  domain = ' + index + ';',
              '  pgc = ' + pgcIndex + ';',
              '  lang = pickLang(' + index + ') || lang;',
              '  cellN = 1;',
              '  console.log(domain, lang, pgc); // DEBUG',
              '  if(this.pre()){return;}',
              '  playCurrentMenuCell();',
              '  if(this.cell()){return;}',
              '},',
              'next_pgc: ' + (pgci_srp.pgc.next_pgc_nr || 0) + ',',
              'prev_pgc: ' + (pgci_srp.pgc.prev_pgc_nr || 0) + ',',
              'goup_pgc: ' + (pgci_srp.pgc.goup_pgc_nr || 0) + ',',
              'still_time: ' + (pgci_srp.pgc.still_time || 0) + ',',
              'cells: ' + JSON.stringify(cellsJs) + ',',
              'pre: function() {' +
                recompile(pgci_srp.pgc.command_tbl.pre_cmds) +
                '},',
              'post: function() {' +
                recompile(pgci_srp.pgc.command_tbl.post_cmds) +
                '},',
              'cell: function() {' +
                recompile(pgci_srp.pgc.command_tbl.cell_cmds) +
                '}',
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

        return source.map(function (cell) {
          var menuCell =
            menuCellTable[String(cell.cellID)] &&
            menuCellTable[String(cell.cellID)][String(cell.vobID)];
          return {
            cellID: cell.cellID,
            vobID: cell.vobID,
            still_time:
              cell.still_time != null
                ? cell.still_time
                : menuCell && menuCell.still_time,
            startSec:
              cell.startSec != null
                ? cell.startSec
                : menuCell && menuCell.startSec,
            endSec:
              cell.endSec != null
                ? cell.endSec
                : menuCell && menuCell.endSec,
            hli_s_ptm: menuCell && menuCell.hli_s_ptm,
            buttons: (menuCell && menuCell.buttons) || [],
            spuSelect: (menuCell && menuCell.spuSelect) || [],
            spuActivate: (menuCell && menuCell.spuActivate) || [],
          };
        });
      }
    }

    function btn_cmd(json, code) {
      if (!json.menu_c_adt || !json.menu_c_adt.nr_of_vobs) {
        return code;
      }

      code.push('btnCmd[' + pointer + '] = [];');
      code.push('btnNav[' + pointer + '] = [];');

      for (var i = 0; i < json.menu_c_adt.nr_of_vobs; i++) {
        var vobPointer = json.menu_c_adt.cell_adr_table[i].vob_id;
        var vob = json.menu_c_adt.cell_adr_table[i];
        var start = vob.start_sector;

        var navFile = path.join(
          webPath,
          basename + '-' + toHex(start) + '.json'
        );
        var pci = loadJsonFile(navFile).pci;

        code.push('btnCmd[' + pointer + '][' + vobPointer + '] = [];');
        code.push('btnNav[' + pointer + '][' + vobPointer + '] = [];');
        for (var j = 0; j < pci.hli.hl_gi.btn_ns; j++) {
          var cmd = pci.hli.btnit[j].cmd;
          var btn = pci.hli.btnit[j];
          code.push(
            'btnCmd[' +
              pointer +
              '][' +
              vobPointer +
              '][' +
              j +
              '] = function() {domain = ' +
              pointer +
              ';' +
              recompile([cmd]) +
              '};'
          );
          code.push(
            'btnNav[' +
              pointer +
              '][' +
              vobPointer +
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
        var langCode = utils.bit2str(lu.lang_code);
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
        'function init() {',
        '  lang = pickLang(0) || lang;',
        '',
        '  dvd.addEventListener(\'click\', function(event) {',
        '    event.stopImmediatePropagation();',
        '    var target = event.target;',
        '    var domain = target.parentNode.dataset.domain;',
        '    var vob = target.parentNode.dataset.vob;',
        '    var id = target.dataset.id;',
        '',
        '    sprm["HL_BTNN"] = (parseInt(id, 10) + 1) * 0x0400;',
        '',
        '    if (target.tagName !== \'INPUT\' || domain === undefined || vob === undefined || id === undefined) {',
        '      return;',
        '    }',
        '',
        '    if (dvd.setMenuHighlight) { dvd.setMenuHighlight(target.parentNode, parseInt(id, 10)); }',
        '    if (dvd.flashMenuActivate) { dvd.flashMenuActivate(target.parentNode, parseInt(id, 10)); }',
        '',
        '    if (!btnCmd[domain] || !btnCmd[domain][vob] || !btnCmd[domain][vob][id]) {',
        '      console.error(\'Missing button command for\', domain, vob, id);',
        '      return;',
        '    }',
        '',
        '    console.log(domain, vob, id, btnCmd[domain][vob][id]);',
        '    btnCmd[domain][vob][id]();',
        '  });',
        '',
        '  document.addEventListener(\'keydown\', function(event) {',
        '    var menu = dvd.querySelector(\'x-menu:not([hidden])\') || dvd.querySelector(\'x-menu[style*="display: block"]\');',
        '    if (!menu) {',
        '      var menus = dvd.querySelectorAll(\'x-menu\');',
        '      for (var mi = 0; mi < menus.length; mi++) {',
        '        if (menus[mi].offsetParent !== null || (menus[mi].style && menus[mi].style.display === \'block\')) { menu = menus[mi]; break; }',
        '      }',
        '    }',
        '    if (!menu) { return; }',
        '    var domain = menu.dataset.domain;',
        '    var vob = menu.dataset.vob;',
        '    if (domain === undefined || vob === undefined) { return; }',
        '    var nav = btnNav[domain] && btnNav[domain][vob];',
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
        '      if (btnCmd[domain] && btnCmd[domain][vob] && btnCmd[domain][vob][idx]) {',
        '        btnCmd[domain][vob][idx]();',
        '      }',
        '      return;',
        '    } else { return; }',
        '',
        '    if (!nextId) { return; }',
        '    event.preventDefault();',
        '    sprm["HL_BTNN"] = nextId * 0x0400;',
        '    if (dvd.setMenuHighlight) { dvd.setMenuHighlight(menu, nextId - 1); }',
        '    var nextEntry = nav[nextId - 1];',
        '    if (nextEntry && nextEntry.auto_action_mode && btnCmd[domain][vob][nextId - 1]) {',
        '      btnCmd[domain][vob][nextId - 1]();',
        '    }',
        '  });',
        '',
        '  dvd.onmenu = function(event) {',
        '    lang = pickLang(domain) || pickLang(0) || lang;',
        '    var menu = null;',
        '    var domainMenus = MENU_TYPES[domain] && MENU_TYPES[domain][lang];',
        '    var vmgmMenus = MENU_TYPES[0] && MENU_TYPES[0][lang];',
        '    if (domainMenus && domainMenus[3 /* Root */]) {',
        '      menu = domainMenus[3 /* Root */];',
        '    } else if (vmgmMenus && vmgmMenus[2 /* Title */]) {',
        '      menu = vmgmMenus[2 /* Title */];',
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
