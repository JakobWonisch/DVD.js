// Generate menu cell table (stills + sector/time map).

'use strict';

import { loadJsonFile } from '../utils/loadJson.js';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';

import * as serverUtils from '../../server/utils/index.js';
import editMetadataFile from '../../server/utils/editMetadataFile.js';
import { dvdTimeToSeconds } from '../../server/utils/dvdTime.js';

var spawn = child_process.spawn;

/**
 * The length of one Logical Block of a DVD.
 * @const
 */
var DVD_VIDEO_LB_LEN = 2048;

export default extractMenu;

/**
 * Generate menu cell table with still PNGs and seek metadata.
 *
 * @param {string} dvdPath
 * @param {function} callback
 */
function extractMenu(dvdPath: string, callback) {
  process.stdout.write('\nExtracting menu cell table:\n');

  var dvdName = dvdPath.split(path.sep).pop();
  var webPath = serverUtils.getWebPath(dvdPath);

  var ifoPath = getWebName('metadata');
  var filesList = loadJsonFile(ifoPath);

  var menuCell = [];
  var pointer = 0;

  next(filesList[pointer].ifo);

  function next(ifoFile: string) {
    ifoFile = path.join(webPath, '../', ifoFile);
    var json = loadJsonFile(ifoFile);
    var inputFile = path
      .join(dvdPath, 'VIDEO_TS', path.basename(ifoFile, '.json') + '.VOB')
      .replace(/ /, '\\ ');

    var timingByKey = buildCellTimingMap(json);
    var vobPointer = 0;

    extractStillImage();

    function extractStillImage() {
      if (!json.menu_c_adt) {
        callNext();
        return;
      }

      var vob = json.menu_c_adt.cell_adr_table[vobPointer];
      var start = vob.start_sector * DVD_VIDEO_LB_LEN;
      var end = (vob.last_sector + 1) * DVD_VIDEO_LB_LEN;
      var outputFile = path.resolve(
        ifoFile,
        '..',
        'stillFrame' + pointer + '-' + vobPointer + '.mpg'
      );

      var cellID = vob.cell_id;
      var vobID = vob.vob_id;
      var timing = timingByKey[cellID + ':' + vobID] || {};

      fs.readFile(inputFile, { flag: 'r' }, function (err, data) {
        if (err) {
          throw err;
        }

        var buffer = data.slice(start, end);

        fs.open(outputFile, 'w+', function (err, fd) {
          if (err) {
            throw err;
          }

          fs.write(fd, buffer, 0, buffer.length, null, function (err) {
            if (err) {
              throw err;
            }

            var imgFile = path.resolve(
              outputFile,
              '..',
              'menu-' + pointer + '-' + cellID + '-' + vobID + '.png'
            );

            outputFile = outputFile.replace(' ', '\\ ');
            imgFile = imgFile.replace(' ', '\\ ');

            var cmd = [
              '-i',
              outputFile,
              '-frames',
              '1',
              '-f',
              'image2',
              imgFile,
              '-y',
            ];

            var ffmpeg = spawn('ffmpeg', cmd);

            ffmpeg.on('error', function (err) {
              console.error(err);
            });

            ffmpeg.on('close', function () {
              process.stdout.write('.');

              if (!menuCell[pointer]) {
                menuCell[pointer] = {};
                menuCell[pointer].menuCell = {};
              }
              if (!menuCell[pointer].menuCell[cellID]) {
                menuCell[pointer].menuCell[cellID] = {};
              }
              if (!menuCell[pointer].menuCell[cellID][vobID]) {
                menuCell[pointer].menuCell[cellID][vobID] = {};
              }
              var entry = menuCell[pointer].menuCell[cellID][vobID];
              entry.still =
                '/' +
                dvdName +
                '/menu-' +
                pointer +
                '-' +
                cellID +
                '-' +
                vobID +
                '.png';
              entry.start_sector = vob.start_sector;
              entry.last_sector = vob.last_sector;
              if (timing.startSec != null) {
                entry.startSec = timing.startSec;
              }
              if (timing.endSec != null) {
                entry.endSec = timing.endSec;
              }
              if (timing.still_time != null) {
                entry.still_time = timing.still_time;
              }
              if (timing.playback_mode != null) {
                entry.playback_mode = timing.playback_mode;
              }

              vobPointer++;
              if (vobPointer < json.menu_c_adt.nr_of_vobs) {
                setTimeout(function () {
                  extractStillImage();
                }, 0);
              } else {
                callNext();
              }
            });
          });
        });
      });

      function callNext() {
        pointer++;
        if (pointer < filesList.length) {
          setTimeout(function () {
            next(filesList[pointer].ifo);
          }, 0);
        } else {
          editMetadataFile(getWebName('metadata'), menuCell, function () {
            callback();
          });
        }
      }
    }
  }

  /**
   * Map cellID:vobID → start/end seconds within the menu VOB timeline.
   */
  function buildCellTimingMap(json) {
    var map = {};
    if (!json.pgci_ut || !json.pgci_ut.lu) {
      return map;
    }

    for (var i = 0; i < json.pgci_ut.lu.length; i++) {
      var lu = json.pgci_ut.lu[i];
      if (!lu.pgcit || !lu.pgcit.pgci_srp) {
        continue;
      }
      for (var j = 0; j < lu.pgcit.pgci_srp.length; j++) {
        var pgc = lu.pgcit.pgci_srp[j].pgc;
        if (!pgc || !pgc.cell_position || !pgc.cell_playback) {
          continue;
        }
        var t = 0;
        for (var c = 0; c < pgc.cell_position.length; c++) {
          var pos = pgc.cell_position[c];
          var playback = pgc.cell_playback[c];
          var duration = playback
            ? dvdTimeToSeconds(playback.playback_time)
            : 0;
          var key = pos.cell_nr + ':' + pos.vob_id_nr;
          if (!map[key]) {
            map[key] = {
              startSec: t,
              endSec: t + duration,
              still_time: playback ? playback.still_time : 0,
              playback_mode: playback ? playback.playback_mode : 0,
            };
          }
          t += duration;
        }
      }
    }
    return map;
  }

  function getWebName(name: string): string {
    return path.join(webPath, getJsonFileName(name));
  }
}

function getJsonFileName(name: string): string {
  return name.replace(/\.IFO$/i, '') + '.json';
}
