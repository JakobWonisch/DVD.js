// Generate buttons for menu UI (CSS hitboxes + D-pad adjacency).

'use strict';

import { loadJsonFile } from '../utils/loadJson.js';

import * as fs from 'node:fs';
import * as path from 'node:path';

import * as serverUtils from '../../server/utils/index.js';
import editMetadataFile from '../../server/utils/editMetadataFile.js';
import * as utils from '../../utils.js';
import { resolveMenuFrameHeight } from './menuFrameHeight.js';
import { menuCellAdrCount } from './menuCellAdrCount.js';

var toHex = utils.toHex;

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

    generateButtonsCss();

    function generateButtonsCss() {
      if (!ifoJson.menu_c_adt) {
        callNext();
        return;
      }

      var vob = ifoJson.menu_c_adt.cell_adr_table[vobPointer];
      var start = vob.start_sector;

      var cellID = vob.cell_id;
      var vobID = vob.vob_id;

      var navFile = path.join(webPath, basename + '-' + toHex(start) + '.json');
      var json = loadJsonFile(navFile);

      var cssContent = [];
      var buttons = [];
      var hli_s_ptm = null;
      var hli_e_ptm = null;

      if (
        json.pci &&
        json.pci.hli &&
        json.pci.hli.hl_gi &&
        json.pci.hli.hl_gi.btn_ns !== undefined
      ) {
        hli_s_ptm = json.pci.hli.hl_gi.hli_s_ptm;
        hli_e_ptm = json.pci.hli.hl_gi.hli_e_ptm;

        // Scale PCI y coords by this disc's menu frame (IFO VTSM/VMGM
        // video_format: PAL 576 / NTSC 480). Title vts_video_attr is ignored.
        var frameHeight = resolveMenuFrameHeight(
          ifoJson,
          json.pci.hli.btnit,
          json.pci.hli.hl_gi.btn_ns
        );

        for (var i = 0; i < json.pci.hli.hl_gi.btn_ns; i++) {
          var btn = json.pci.hli.btnit[i];
          cssContent.push(
            `[data-domain="${pointer}"][data-cell="${cellID}"][data-vob="${vobID}"] .btn[data-id="${i}"]{` +
              buttonToCss(btn, i, frameHeight) +
              '}'
          );

          buttons.push({
            id: i,
            up: btn.up || 0,
            down: btn.down || 0,
            left: btn.left || 0,
            right: btn.right || 0,
            auto_action_mode: btn.auto_action_mode || 0,
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
          css[pointer].css[cellID - 1][vobID - 1].push(
            buttonToCss(btn, i, frameHeight)
          );
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
