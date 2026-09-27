// Convert IFO files and save as JSON.

// <reference path="../../references.ts" />

'use strict';


import * as fs from 'node:fs';
import * as path from 'node:path';
import jDataView from 'jdataview';

import * as ifoRead from '../../dvdread/ifo_read.js';
import * as ifoTypes from '../../dvdread/ifo_types.js';
import * as serverUtils from '../../server/utils/index.js';
import editMetadataFile from '../../server/utils/editMetadataFile.js';
import { globFiles } from '../../server/utils/globFiles.js';

var ifo_handle_t = ifoTypes.ifo_handle_t;
var getFileIndex = serverUtils.getFileIndex;

/** Minimum IFO size (one DVD sector). Empty placeholder IFOs are skipped. */
var DVD_IFO_MIN_BYTES = 2048;

export default convertIfo;

/**
 * Convert IFO files from a folder to JSON files.
 *
 * @param {string} dvdPath
 * @param {function} callback
 */
function convertIfo(dvdPath: string, callback) {
  process.stdout.write('\nConverting IFO files:\n');

  var dvdName = dvdPath.split(path.sep).pop();
  var webPath = serverUtils.getWebPath(dvdPath);

  var ifoPath = path.join(dvdPath, 'VIDEO_TS', '*.IFO');
  globFiles(ifoPath, function(err, ifoFiles) {
    if (err) {
      console.error(err);
    }

    var filesList = [];
    var pointer = 0;

    next(ifoFiles[pointer]);

    // There are better ways to do async...
    function next(ifoFile: string) {
      var name = path.basename(ifoFile);
      var index = getFileIndex(name);

      fs.readFile(ifoFile, function(err, data) {
        if (err) {
          console.error(err);
          advance();
          return;
        }

        // Multi-title discs sometimes ship empty placeholder IFO/VOB stubs.
        if (!data || data.length < DVD_IFO_MIN_BYTES) {
          console.warn(
            'Skipping empty/invalid IFO:',
            name,
            '(' + (data ? data.length : 0) + ' bytes)'
          );
          advance();
          return;
        }

        var ifoFileHandle = new ifo_handle_t();
        ifoFileHandle.file = {
          name: name,
          size: data.length,
          view: new jDataView(data, undefined, undefined, false),
          path: ''
        };

        var parsed;
        try {
          parsed = ifoRead.parseIFO(ifoFileHandle);
        } catch (parseErr) {
          console.error('Failed to parse IFO', name + ':', parseErr);
          advance();
          return;
        }

        if (!parsed || (!parsed.vmgi_mat && !parsed.vtsi_mat)) {
          console.warn('Skipping IFO with no VMGI/VTSI header:', name);
          advance();
          return;
        }

        filesList[index] = {};
        filesList[index].ifo = '/' + dvdName + '/' + getJsonFileName(name);

        // We don't need all the properties from the original object.
        var json = {
          file: {
            file: {
              name: name,
              size: data.length
            },
            view: null,
            path: ''
          },

          // VMGI
          vmgi_mat: parsed.vmgi_mat,
          tt_srpt: parsed.tt_srpt,
          first_play_pgc: parsed.first_play_pgc,
          ptl_mait: parsed.ptl_mait,
          vts_atrt: parsed.vts_atrt,
          txtdt_mgi: parsed.txtdt_mgi,

          // Common
          pgci_ut: parsed.pgci_ut,
          menu_c_adt: parsed.menu_c_adt,
          menu_vobu_admap: parsed.menu_vobu_admap,

          // VTSI
          vtsi_mat: parsed.vtsi_mat,
          vts_ptt_srpt: parsed.vts_ptt_srpt,
          vts_pgcit: parsed.vts_pgcit,
          vts_tmapt: parsed.vts_tmapt,
          vts_c_adt: parsed.vts_c_adt,
          vts_vobu_admap: parsed.vts_vobu_admap
        };

        var jsonPath = getWebName(name);
        fs.writeFile(jsonPath, JSON.stringify(json), function(writeErr) {
          if (writeErr) {
            console.error(writeErr);
          }

          process.stdout.write('.');
          advance();
        });
      });

      function advance() {
        pointer++;
        if (pointer < ifoFiles.length) {
          setTimeout(function() {
            next(ifoFiles[pointer]);
          }, 0);
        } else {
          // Save a metadata file containing the list of all IFO files.
          // Skipped titles leave holes; keep title-set indices stable for domains.
          editMetadataFile(getWebName('metadata'), filesList, function() {
            callback();
          });
        }
      }
    }
  });

  /**
   * Return the file path for the web given a file.
   * Used for naming both the IFO files and the metadata file.
   *
   * @param name A file name.
   * @return {string}
   */
  function getWebName(name: string): string {
    return path.join(webPath, getJsonFileName(name));
  }
}

/**
 * Transform the file name of a JSON file.
 *
 * @param {string} name A file name.
 * @return {string}
 */
function getJsonFileName(name: string): string {
  return name.replace(/\.IFO$/i, '') + '.json';
}
