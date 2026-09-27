// Generate menu cell table (stills + sector/time map).

'use strict';

import { loadJsonFile } from '../utils/loadJson.js';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import * as os from 'node:os';

import * as serverUtils from '../../server/utils/index.js';
import { mergeMenuCellMaps } from './mergeMenuCellMaps.js';
import { menuCellAdrCount } from './menuCellAdrCount.js';
import { buildMenuCellTimingMap } from './buildMenuCellTimingMap.js';
import {
  DVD_VIDEO_LB_LEN,
  listNavSectorsForBasename,
  pickHighlightNav,
  resolveMenuStillSeek,
  type NavPtsLike,
} from './menuStillSeek.js';

var spawn = child_process.spawn;

/** Skip cells that are only a few packs (no usable video). */
var MIN_CELL_BYTES = 64 * 1024;

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
    var basename = path.basename(ifoFile, '.json');
    var navIndex = listNavSectorsForBasename(
      fs.existsSync(webPath) ? fs.readdirSync(webPath) : [],
      basename,
    );
    var navBySector = new Map<number, NavPtsLike>();
    navIndex.forEach(function (fileName, sector) {
      try {
        navBySector.set(
          sector,
          loadJsonFile(path.join(webPath, fileName)) as NavPtsLike,
        );
      } catch (e) {
        // ignore unreadable NAV sidecars
      }
    });

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
      var timing = timingByKey[cellID + ':' + vobID];
      var imgFile = path.join(
        webPath,
        'menu-' + pointer + '-' + cellID + '-' + vobID + '.png'
      );

      ensureMenuCellEntry(cellID, vobID);
      var entry = menuCell[pointer].menuCell[cellID][vobID];
      entry.start_sector = vob.start_sector;
      entry.last_sector = vob.last_sector;
      if (timing && timing.startSec != null) {
        entry.startSec = timing.startSec;
      }
      if (timing && timing.endSec != null) {
        entry.endSec = timing.endSec;
      }
      if (timing && timing.still_time != null) {
        entry.still_time = timing.still_time;
      }
      if (timing && timing.playback_mode != null) {
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

      var highlight = pickHighlightNav(
        vob.start_sector,
        vob.last_sector,
        navBySector,
      );
      var seek = resolveMenuStillSeek({
        cellStartSector: vob.start_sector,
        cellLastSector: vob.last_sector,
        highlight: highlight,
        timing: timing,
      });

      extractBestStillPng(inputFile, seek, imgFile, function (ok) {
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
        if (vobPointer < menuCellAdrCount(json.menu_c_adt)) {
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
   * Decode a short window at the resolved seek (HLI / mid-cell) and keep the
   * largest usable PNG. Avoids long early scans that latch onto wipe frames.
   */
  function extractBestStillPng(vobFile, seek, imgFile, done) {
    var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvdjs-still-'));
    var pattern = path.join(tmpDir, 'f_%03d.png');

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
      String(seek.skipBytes),
      '-i',
      vobFile,
      '-ss',
      String(seek.ssSec || 0),
      '-map',
      '0:v:0',
      '-t',
      String(seek.durationSec),
      '-frames:v',
      String(seek.frameCount),
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
      // Preserve css / buttons / SPU from generateButtons + extractSpu when
      // stills are re-run alone (full replace was wiping interactive menus).
      content[i].menuCell = mergeMenuCellMaps(
        content[i].menuCell,
        entry.menuCell,
      );
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
    return buildMenuCellTimingMap(json);
  }

  function getWebName(name: string): string {
    return path.join(webPath, getJsonFileName(name));
  }
}

function getJsonFileName(name: string): string {
  return name.replace(/\.IFO$/i, '') + '.json';
}
