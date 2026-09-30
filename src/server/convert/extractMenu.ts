// Extract menu still-frame maps (all cells per PGC).

'use strict';

import { loadJsonFile } from '../utils/loadJson.js';

import * as path from 'node:path';

import * as serverUtils from '../../server/utils/index.js';
import * as utils from '../../utils.js';
import editMetadataFile from '../../server/utils/editMetadataFile.js';
import { dvdTimeToSeconds } from '../../server/utils/dvdTime.js';

export default extractMenu;

/**
 * Extract menu metadata: language → PGC → cells (vob/cell + timing).
 *
 * @param {string} dvdPath
 * @param {function} callback
 */
function extractMenu(dvdPath: string, callback) {
  process.stdout.write('\nExtracting menu still frames:\n');

  var webPath = serverUtils.getWebPath(dvdPath);

  var ifoPath = getWebName('metadata');
  var filesList = loadJsonFile(ifoPath);

  var menu = [];
  var pointer = 0;

  next(filesList[pointer] && filesList[pointer].ifo);

  // There are better ways to do async...
  function next(ifoFile: string) {
    if (!ifoFile) {
      callNext();
      return;
    }

    ifoFile = path.join(webPath, '../', ifoFile);
    var json = loadJsonFile(ifoFile);

    menu[pointer] = {};
    menu[pointer].menu = {};

    extractMenuData();

    function extractMenuData() {
      if (!json.pgci_ut || !json.pgci_ut.lu || !Array.isArray(json.pgci_ut.lu)) {
        callNext();
        return;
      }

      for (var i = 0; i < json.pgci_ut.nr_of_lus; i++) {
        var lu = json.pgci_ut.lu[i];
        var lang = utils.ifoMenuLangCode(lu.lang_code);
        menu[pointer].menu[lang] = [];
        if (!lu.pgcit || !lu.pgcit.pgci_srp) {
          continue;
        }
        for (var j = 0; j < lu.pgcit.nr_of_pgci_srp; j++) {
          var pgci_srp = lu.pgcit.pgci_srp[j];
          var pgcIndex = j + 1;
          var pgc = pgci_srp.pgc || {};
          var cells = [];
          var t = 0;

          if (pgc.cell_position && pgc.cell_position.length) {
            for (var c = 0; c < pgc.cell_position.length; c++) {
              var pos = pgc.cell_position[c];
              var playback = pgc.cell_playback && pgc.cell_playback[c];
              var duration = playback
                ? dvdTimeToSeconds(playback.playback_time)
                : 0;
              var startSec = t;
              t += duration;
              cells.push({
                cellID: pos.cell_nr,
                vobID: pos.vob_id_nr,
                still_time: playback ? playback.still_time : 0,
                playback_mode: playback ? playback.playback_mode : 0,
                first_sector: playback ? playback.first_sector : null,
                last_sector: playback ? playback.last_sector : null,
                startSec: startSec,
                endSec: t,
                duration: duration,
              });
            }
          }

          var first = cells[0] || {};
          menu[pointer].menu[lang].push({
            pgc: pgcIndex,
            entry: pgci_srp.entry_id,
            vobID: first.vobID != null ? first.vobID : null,
            cellID: first.cellID != null ? first.cellID : null,
            still_time: pgc.still_time || 0,
            pg_playback_mode: pgc.pg_playback_mode || 0,
            cells: cells,
          });
        }
      }

      callNext();
    }

    function callNext() {
      pointer++;
      if (pointer < filesList.length) {
        setTimeout(function () {
          next(filesList[pointer] && filesList[pointer].ifo);
        }, 0);
      } else {
        editMetadataFile(getWebName('metadata'), menu, function () {
          callback();
        });
      }
    }
  }

  /**
   * @param name A file name.
   * @return {string}
   */
  function getWebName(name: string): string {
    return path.join(webPath, getJsonFileName(name));
  }
}

/**
 * @param {string} name A file name.
 * @return {string}
 */
function getJsonFileName(name: string): string {
  return name.replace(/\.IFO$/i, '') + '.json';
}
