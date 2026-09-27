// Generate menu cell table (stills + sector/time map).

'use strict';

import { loadJsonFile } from '../utils/loadJson.js';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import * as os from 'node:os';

import * as serverUtils from '../../server/utils/index.js';
import { dvdTimeToSeconds } from '../../server/utils/dvdTime.js';

var spawn = child_process.spawn;

/**
 * The length of one Logical Block of a DVD.
 * @const
 */
var DVD_VIDEO_LB_LEN = 2048;

/** Skip cells that are only a few packs (no usable video). */
var MIN_CELL_BYTES = 64 * 1024;

/** Decode this many frames and keep the largest PNG (skips lead-in gray). */
var STILL_FRAME_CANDIDATES = 48;

/** PNGs smaller than this are treated as failed/gray stills. */
var MIN_STILL_BYTES = 8 * 1024;

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

  next(filesList[pointer] && filesList[pointer].ifo);

  function next(ifoFile: string) {
    if (!ifoFile) {
      callNext();
      return;
    }

    ifoFile = path.join(webPath, '../', ifoFile);
    var json = loadJsonFile(ifoFile);
    var inputFile = path.join(
      dvdPath,
      'VIDEO_TS',
      path.basename(ifoFile, '.json') + '.VOB'
    );

    var timingByKey = buildCellTimingMap(json);
    var vobPointer = 0;

    extractStillImage();

    function extractStillImage() {
      if (!json.menu_c_adt) {
        callNext();
        return;
      }

      if (!fs.existsSync(inputFile)) {
        console.error('Missing menu VOB:', inputFile);
        callNext();
        return;
      }

      var vob = json.menu_c_adt.cell_adr_table[vobPointer];
      var start = vob.start_sector * DVD_VIDEO_LB_LEN;
      var end = (vob.last_sector + 1) * DVD_VIDEO_LB_LEN;
      var cellBytes = end - start;
      var cellID = vob.cell_id;
      var vobID = vob.vob_id;
      var timing = timingByKey[cellID + ':' + vobID] || {};
      var imgFile = path.join(
        webPath,
        'menu-' + pointer + '-' + cellID + '-' + vobID + '.png'
      );

      ensureMenuCellEntry(cellID, vobID);
      var entry = menuCell[pointer].menuCell[cellID][vobID];
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

      if (cellBytes < MIN_CELL_BYTES) {
        console.warn(
          'Skipping tiny menu cell',
          path.basename(imgFile),
          '(' + cellBytes + ' bytes)'
        );
        finishCell();
        return;
      }

      extractBestStillPng(inputFile, start, timing, imgFile, function (ok) {
        if (ok) {
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
          process.stdout.write('.');
        } else {
          console.warn('No usable still for', path.basename(imgFile));
          try {
            fs.unlinkSync(imgFile);
          } catch (e) {
            // ignore
          }
        }
        finishCell();
      });

      function finishCell() {
        vobPointer++;
        if (vobPointer < json.menu_c_adt.nr_of_vobs) {
          setTimeout(extractStillImage, 0);
        } else {
          callNext();
        }
      }
    }

    function ensureMenuCellEntry(cellID, vobID) {
      if (!menuCell[pointer]) {
        menuCell[pointer] = { menuCell: {} };
      }
      if (!menuCell[pointer].menuCell[cellID]) {
        menuCell[pointer].menuCell[cellID] = {};
      }
      if (!menuCell[pointer].menuCell[cellID][vobID]) {
        menuCell[pointer].menuCell[cellID][vobID] = {};
      }
    }

    function callNext() {
      pointer++;
      if (pointer < filesList.length) {
        setTimeout(function () {
          next(filesList[pointer] && filesList[pointer].ifo);
        }, 0);
      } else {
        stampMenuCellMetadata(menuCell, function () {
          callback();
        });
      }
    }
  }

  /**
   * Decode a short window from the cell and keep the largest PNG.
   * DVD cells often start with NAV/blank/corrupt frames before a real picture.
   */
  function extractBestStillPng(vobFile, startBytes, timing, imgFile, done) {
    var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvdjs-still-'));
    var pattern = path.join(tmpDir, 'f_%03d.png');
    var duration =
      timing.endSec != null &&
      timing.startSec != null &&
      timing.endSec > timing.startSec
        ? Math.min(3, Math.max(1, timing.endSec - timing.startSec))
        : 2;

    var cmd = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-analyzeduration',
      '50M',
      '-probesize',
      '20M',
      '-fflags',
      '+genpts+discardcorrupt',
      '-err_detect',
      'ignore_err',
      '-skip_initial_bytes',
      String(startBytes),
      '-i',
      vobFile,
      '-map',
      '0:v:0',
      '-t',
      String(duration),
      '-frames:v',
      String(STILL_FRAME_CANDIDATES),
      '-vf',
      'yadif=0:-1:0,format=rgb24',
      '-y',
      pattern,
    ];

    var child = spawn('ffmpeg', cmd);
    var errBuf = '';
    child.stderr.on('data', function (d) {
      errBuf += d.toString();
    });
    child.on('error', function (err) {
      console.error(err);
      cleanupDir(tmpDir);
      done(false);
    });
    child.on('close', function () {
      var best = null;
      var bestSize = 0;
      try {
        var files = fs.readdirSync(tmpDir).filter(function (f) {
          return f.endsWith('.png');
        });
        for (var i = 0; i < files.length; i++) {
          var full = path.join(tmpDir, files[i]);
          var size = fs.statSync(full).size;
          if (size > bestSize) {
            bestSize = size;
            best = full;
          }
        }
      } catch (e) {
        console.error(e);
      }

      if (!best || bestSize < MIN_STILL_BYTES) {
        if (errBuf) {
          process.stderr.write(errBuf.slice(0, 500));
        }
        cleanupDir(tmpDir);
        done(false);
        return;
      }

      try {
        fs.copyFileSync(best, imgFile);
        cleanupDir(tmpDir);
        done(true);
      } catch (e) {
        console.error(e);
        cleanupDir(tmpDir);
        done(false);
      }
    });
  }

  function cleanupDir(dir) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  }

  function stampMenuCellMetadata(menuCellData, done) {
    var metaPath = getWebName('metadata');
    var content: any[] = [];
    try {
      if (fs.existsSync(metaPath)) {
        content = loadJsonFile(metaPath);
      }
    } catch (e) {
      content = [];
    }
    if (!Array.isArray(content)) {
      content = [];
    }

    menuCellData.forEach(function (entry, i) {
      if (!entry) {
        return;
      }
      if (!content[i]) {
        content[i] = {};
      }
      content[i].menuCell = entry.menuCell;
    });

    fs.writeFile(metaPath, JSON.stringify(content), function (err) {
      if (err) {
        console.error(err);
      }
      process.stdout.write('.');
      done();
    });
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
