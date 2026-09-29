// Extract menu SPU overlays (base + select/activate) during convert.

'use strict';

import { loadJsonFile } from '../utils/loadJson.js';

import * as fs from 'node:fs';
import * as path from 'node:path';

import * as serverUtils from '../../server/utils/index.js';
import editMetadataFile from '../../server/utils/editMetadataFile.js';
import * as utils from '../../utils.js';
import { pickMenuSpu } from '../spu/demux.js';
import { decodeSpu } from '../spu/decode.js';
import {
  renderActivateSpuPng,
  renderBaseSpuPng,
  renderSelectSpuPng,
} from '../spu/render.js';
import { resolveMenuFrameHeight } from './menuFrameHeight.js';
import { menuCellAdrCount } from './menuCellAdrCount.js';

var toHex = utils.toHex;

/** DVD logical block size. */
var DVD_VIDEO_LB_LEN = 2048;

export default extractSpu;

/**
 * Bake SPU PNG overlays for each menu cell that has highlight info.
 *
 * @param {string} dvdPath
 * @param {function} callback
 */
function extractSpu(dvdPath: string, callback) {
  process.stdout.write('\nExtracting menu SPU overlays:\n');

  var dvdName = serverUtils.getDiscId(dvdPath);
  var webPath = serverUtils.getWebPath(dvdPath);
  var ifoPath = getWebName('metadata');
  var filesList = loadJsonFile(ifoPath);

  var patch = [];
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

    var vobPath = path
      .join(dvdPath, 'VIDEO_TS', basename + '.VOB')
      .replace(/\\/g, '');

    if (!ifoJson.menu_c_adt) {
      callNext();
      return;
    }

    if (!fs.existsSync(vobPath)) {
      process.stdout.write('x');
      callNext();
      return;
    }

    var vobData = fs.readFileSync(vobPath);
    var vobPointer = 0;

    processCell();

    function processCell() {
      if (vobPointer >= menuCellAdrCount(ifoJson.menu_c_adt)) {
        callNext();
        return;
      }

      var vob = ifoJson.menu_c_adt.cell_adr_table[vobPointer];
      var cellID = vob.cell_id;
      var vobID = vob.vob_id;
      var start = vob.start_sector;
      var end = vob.last_sector;

      var navFile = path.join(webPath, basename + '-' + toHex(start) + '.json');
      var nav = null;
      try {
        nav = loadJsonFile(navFile);
      } catch (e) {
        nav = null;
      }

      var btnNs =
        nav &&
        nav.pci &&
        nav.pci.hli &&
        nav.pci.hli.hl_gi &&
        nav.pci.hli.hl_gi.btn_ns;

      // Still try to extract SPU even without buttons (motion overlays).
      var cellBytes = vobData.subarray(
        start * DVD_VIDEO_LB_LEN,
        (end + 1) * DVD_VIDEO_LB_LEN
      );

      // Only scan the first few VOBUs for a display set (menus put SPU early).
      var scanBytes = cellBytes.subarray(
        0,
        Math.min(cellBytes.length, DVD_VIDEO_LB_LEN * 128)
      );
      var spuPacket = pickMenuSpu(scanBytes);

      if (!spuPacket) {
        vobPointer++;
        setTimeout(processCell, 0);
        return;
      }

      var decoded = decodeSpu(spuPacket);
      if (!decoded) {
        vobPointer++;
        setTimeout(processCell, 0);
        return;
      }

      // Match stills/buttons: PAL menus are 576 lines even when DCSQ y2 < 480.
      var menuHeight = resolveMenuFrameHeight(
        ifoJson,
        nav && nav.pci && nav.pci.hli && nav.pci.hli.btnit,
        btnNs || 0
      );
      if (menuHeight > decoded.frameHeight) {
        decoded.frameHeight = menuHeight;
      }

      var palette = findPalette(ifoJson, cellID, vobID) || defaultPalette();
      var prefix = 'menu-' + pointer + '-' + cellID + '-' + vobID;

      var basePng = renderBaseSpuPng(decoded, palette);
      var baseName = prefix + '-spu.png';
      fs.writeFileSync(path.join(webPath, baseName), basePng);

      var spuSelect = [];
      var spuActivate = [];
      var btnColi =
        nav &&
        nav.pci &&
        nav.pci.hli &&
        nav.pci.hli.btn_colit &&
        nav.pci.hli.btn_colit.btn_coli;

      if (btnNs > 0 && Array.isArray(btnColi)) {
        for (var i = 0; i < btnNs; i++) {
          var btn = nav.pci.hli.btnit[i];
          var rect = {
            x_start: btn.x_start,
            y_start: btn.y_start,
            x_end: btn.x_end,
            y_end: btn.y_end,
            btn_coln: btn.btn_coln || 1,
          };
          var selName = prefix + '-spu-sel-' + i + '.png';
          var actName = prefix + '-spu-act-' + i + '.png';
          fs.writeFileSync(
            path.join(webPath, selName),
            renderSelectSpuPng(decoded, palette, rect, btnColi)
          );
          fs.writeFileSync(
            path.join(webPath, actName),
            renderActivateSpuPng(decoded, palette, rect, btnColi)
          );
          spuSelect.push('/' + dvdName + '/' + selName);
          spuActivate.push('/' + dvdName + '/' + actName);
        }
      }

      if (!patch[pointer]) {
        patch[pointer] = { menuCell: {} };
      }
      if (!patch[pointer].menuCell[cellID]) {
        patch[pointer].menuCell[cellID] = {};
      }
      if (!patch[pointer].menuCell[cellID][vobID]) {
        patch[pointer].menuCell[cellID][vobID] = {};
      }
      var entry = patch[pointer].menuCell[cellID][vobID];
      entry.spu = '/' + dvdName + '/' + baseName;
      entry.spuFrameHeight = decoded.frameHeight;
      if (spuSelect.length) {
        entry.spuSelect = spuSelect;
        entry.spuActivate = spuActivate;
      }

      process.stdout.write('.');
      vobPointer++;
      setTimeout(processCell, 0);
    }

    function callNext() {
      pointer++;
      if (pointer < filesList.length) {
        setTimeout(function () {
          next(filesList[pointer] && filesList[pointer].ifo);
        }, 0);
      } else {
        editMetadataFile(getWebName('metadata'), patch, function () {
          callback();
        });
      }
    }
  }

  function getWebName(name: string): string {
    return path.join(webPath, getJsonFileName(name));
  }
}

/**
 * Find the PGC palette for a menu cell (cell_nr + vob_id_nr).
 */
function findPalette(ifoJson, cellID, vobID): number[] | null {
  if (!ifoJson.pgci_ut || !ifoJson.pgci_ut.lu) {
    return null;
  }
  for (var i = 0; i < ifoJson.pgci_ut.lu.length; i++) {
    var lu = ifoJson.pgci_ut.lu[i];
    if (!lu.pgcit || !lu.pgcit.pgci_srp) {
      continue;
    }
    for (var j = 0; j < lu.pgcit.pgci_srp.length; j++) {
      var pgc = lu.pgcit.pgci_srp[j].pgc;
      if (!pgc || !pgc.cell_position || !pgc.palette) {
        continue;
      }
      for (var c = 0; c < pgc.cell_position.length; c++) {
        var pos = pgc.cell_position[c];
        if (pos.cell_nr === cellID && pos.vob_id_nr === vobID) {
          return pgc.palette;
        }
      }
    }
  }
  // Fallback: first PGC palette in the LU table.
  for (var ii = 0; ii < ifoJson.pgci_ut.lu.length; ii++) {
    var lu2 = ifoJson.pgci_ut.lu[ii];
    if (lu2.pgcit && lu2.pgcit.pgci_srp && lu2.pgcit.pgci_srp[0]) {
      var p = lu2.pgcit.pgci_srp[0].pgc;
      if (p && p.palette) {
        return p.palette;
      }
    }
  }
  return null;
}

function defaultPalette(): number[] {
  var p = [];
  for (var i = 0; i < 16; i++) {
    p.push(0);
  }
  return p;
}

function getJsonFileName(name: string): string {
  return name.replace(/\.IFO$/i, '') + '.json';
}
