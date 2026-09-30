// Generate buttons for menu UI (CSS hitboxes + D-pad adjacency).

'use strict';

import { loadJsonFile } from '../utils/loadJson.js';

import * as fs from 'node:fs';
import * as path from 'node:path';

import * as serverUtils from '../../server/utils/index.js';
import editMetadataFile from '../../server/utils/editMetadataFile.js';
import { resolveMenuFrameHeight } from './menuFrameHeight.js';
import { menuCellAdrCount } from './menuCellAdrCount.js';
import {
  hliDelaySecFromCell,
  loadNavBySectorForBasename,
  pickHighlightNav,
  type NavPtsLike,
} from './menuStillSeek.js';

export default generateButtons;

/**
 * Generate buttons from menu UI.
 *
 * @param {string} dvdPath
 * @param {function} callback
 */
function generateButtons(dvdPath: string, callback) {
  process.stdout.write('\nGenerating buttons:\n');

  var dvdName = serverUtils.getDiscId(dvdPath);
  var webPath = serverUtils.getWebPath(dvdPath);

  var ifoPath = getWebName('metadata');
  var filesList = loadJsonFile(ifoPath);

  var css = [];
  var pointer = 0;

  next(filesList[pointer] && filesList[pointer].ifo);

  function next(ifoFile: string) {
    if (!ifoFile) {
      callNext();
      return;
    }

    ifoFile = path.join(webPath, '../', ifoFile);
    var name = path.basename(ifoFile);
    var basename = path.basename(name, '.json');
    var ifoJson = loadJsonFile(ifoFile);

    var vobPointer = 0;
    var navBySector = loadNavBySectorForBasename(webPath, basename);

    generateButtonsCss();

    function generateButtonsCss() {
      if (!ifoJson.menu_c_adt) {
        callNext();
        return;
      }

      var vob = ifoJson.menu_c_adt.cell_adr_table[vobPointer];
      var cellID = vob.cell_id;
      var vobID = vob.vob_id;

      // Same HLI VOBU as stills — buttons often appear after a wipe, not at
      // cell start (Harry Potter / Avatar).
      var highlight = pickHighlightNav(
        vob.start_sector,
        vob.last_sector,
        navBySector,
      );
      var json = highlight ? highlight.nav : null;

      var cssContent = [];
      var buttons = [];
      var hli_s_ptm = null;
      var hli_e_ptm = null;
      var hliDelaySec = 0;

      if (
        json &&
        json.pci &&
        json.pci.hli &&
        json.pci.hli.hl_gi &&
        json.pci.hli.hl_gi.btn_ns
      ) {
        hli_s_ptm = json.pci.hli.hl_gi.hli_s_ptm;
        hli_e_ptm = json.pci.hli.hl_gi.hli_e_ptm;
        var cellStartNav: NavPtsLike | null = null;
        if (navBySector instanceof Map) {
          cellStartNav = navBySector.get(vob.start_sector) || null;
        } else if (navBySector && typeof navBySector === 'object') {
          cellStartNav = (navBySector as Record<number, NavPtsLike>)[
            vob.start_sector
          ] || null;
        }
        // Nearby pack if C_ADT start is not exactly a NAV sector.
        if (!cellStartNav && navBySector instanceof Map) {
          for (var d = 0; d < 8 && !cellStartNav; d++) {
            cellStartNav = navBySector.get(vob.start_sector + d) || null;
          }
        }
        hliDelaySec = hliDelaySecFromCell(cellStartNav, json);

        // Scale PCI y coords by this disc's menu frame (IFO VTSM/VMGM
        // video_format: PAL 576 / NTSC 480). Title vts_video_attr is ignored.
        var frameHeight = resolveMenuFrameHeight(
          ifoJson,
          json.pci.hli.btnit,
          json.pci.hli.hl_gi.btn_ns
        );

        for (var i = 0; i < json.pci.hli.hl_gi.btn_ns; i++) {
          var btn = json.pci.hli.btnit[i] as {
            x_start: number;
            y_start: number;
            x_end: number;
            y_end: number;
            up?: number;
            down?: number;
            left?: number;
            right?: number;
            auto_action_mode?: number;
          };
          // Inline geometry on each button — viewer applies as style so hitboxes
          // survive data-cell/data-vob drift (multi-cell PGCs / attr resets).
          var geom = buttonToCss(btn, i, frameHeight);
          cssContent.push(
            `[data-domain="${pointer}"][data-cell="${cellID}"][data-vob="${vobID}"] .btn[data-id="${i}"]{` +
              geom +
              '}'
          );

          buttons.push({
            id: i,
            up: btn.up || 0,
            down: btn.down || 0,
            left: btn.left || 0,
            right: btn.right || 0,
            auto_action_mode: btn.auto_action_mode || 0,
            css: geom,
          });

          if (!css[pointer]) {
            css[pointer] = {};
          }
          if (!css[pointer].css) {
            css[pointer].css = [];
          }
          if (!css[pointer].css[cellID - 1]) {
            css[pointer].css[cellID - 1] = [];
          }
          if (!css[pointer].css[cellID - 1][vobID - 1]) {
            css[pointer].css[cellID - 1][vobID - 1] = [];
          }
          css[pointer].css[cellID - 1][vobID - 1].push(geom);
        }

        saveCSSFile(cssContent, json.pci.hli.hl_gi.btn_ns, buttons);
      } else {
        // Still advance even with no buttons.
        vobPointer++;
        if (vobPointer < menuCellAdrCount(ifoJson.menu_c_adt)) {
          setTimeout(function () {
            generateButtonsCss();
          }, 0);
        } else {
          callNext();
        }
      }

      function buttonToCss(btn, i, frameHeight) {
        var fh = frameHeight || 480;
        return (
          'left:' +
          round((btn.x_start / 720) * 100) +
          '%;' +
          'top:' +
          round((btn.y_start / fh) * 100) +
          '%;' +
          'width:' +
          round(((btn.x_end - btn.x_start) / 720) * 100) +
          '%;' +
          'height:' +
          round(((btn.y_end - btn.y_start) / fh) * 100) +
          '%;'
        );

        function round(val) {
          val = val.toFixed(1);

          if (val.substr(-1) === '0') {
            return Math.round(val);
          }

          return val;
        }
      }

      function saveCSSFile(cssContent, btn_nb, buttons) {
        var fileName = 'menu-' + pointer + '-' + cellID + '-' + vobID + '.css';
        cssContent = cssContent.join('');

        fs.writeFile(path.join(webPath, fileName), cssContent, function (err) {
          if (err) {
            console.error(err);
          }

          process.stdout.write('.');

          if (btn_nb > 0) {
            if (!css[pointer]) {
              css[pointer] = {};
            }
            if (!css[pointer].menuCell) {
              css[pointer].menuCell = {};
            }
            if (!css[pointer].menuCell[cellID]) {
              css[pointer].menuCell[cellID] = {};
            }
            if (!css[pointer].menuCell[cellID][vobID]) {
              css[pointer].menuCell[cellID][vobID] = {};
            }
            var entry = css[pointer].menuCell[cellID][vobID];
            entry.css = '/' + dvdName + '/' + fileName;
            entry.btn_nb = btn_nb;
            entry.buttons = buttons;
            if (hli_s_ptm != null) {
              entry.hli_s_ptm = hli_s_ptm;
            }
            if (hli_e_ptm != null) {
              entry.hli_e_ptm = hli_e_ptm;
            }
            if (hliDelaySec > 0) {
              entry.hliDelaySec = hliDelaySec;
            } else {
              delete entry.hliDelaySec;
            }
          }

          vobPointer++;
          if (vobPointer < menuCellAdrCount(ifoJson.menu_c_adt)) {
            setTimeout(function () {
              generateButtonsCss();
            }, 0);
          } else {
            callNext();
          }
        });
      }
    }

    function callNext() {
      pointer++;
      if (pointer < filesList.length) {
        setTimeout(function () {
          next(filesList[pointer] && filesList[pointer].ifo);
        }, 0);
      } else {
        editMetadataFile(getWebName('metadata'), css, function () {
          callback();
        });
      }
    }
  }

  function getWebName(name: string): string {
    return path.join(webPath, getJsonFileName(name));
  }
}

function getJsonFileName(name: string): string {
  return name.replace(/\.IFO$/i, '') + '.json';
}
