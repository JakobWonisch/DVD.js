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
import { menuFrameHeightFromIfo } from './menuFrameHeight.js';
import { writeStillPlaceholder } from './writeStillPlaceholder.js';
import {
  DVD_VIDEO_LB_LEN,
  cellNeedsStillPng,
  cellRelativeSkipBytes,
  isUsableStillPng,
  loadNavBySectorForBasename,
  pickHighlightNav,
  resolveMenuStillSeek,
} from './menuStillSeek.js';

var spawn = child_process.spawn;

/** Skip cells that are only a few packs (no usable video).
 * Copyright / FBI warnings are often ~6–20 sectors (~12–40KB) — still extract. */
var MIN_CELL_BYTES = 8 * 1024;

export default extractMenu;

/**
 * Generate menu cell table with still PNGs and seek metadata.
 *
 * @param {string} dvdPath
 * @param {function} callback
 */
function extractMenu(dvdPath: string, callback) {
  process.stdout.write('\nExtracting menu cell table:\n');

  var dvdName = serverUtils.getDiscId(dvdPath);
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
      path.basename(ifoFile, '.json') + '.VOB',
    );

    var timingByKey = buildCellTimingMap(json);
    var vobPointer = 0;
    var basename = path.basename(ifoFile, '.json');
    var navBySector = loadNavBySectorForBasename(webPath, basename);

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
        'menu-' + pointer + '-' + cellID + '-' + vobID + '.png',
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

      var stillUrl =
        '/' + dvdName + '/menu-' + pointer + '-' + cellID + '-' + vobID + '.png';
      var stillLabel = pointer + '-' + cellID + '-' + vobID;
      var stillHeight = menuFrameHeightFromIfo(json);
      var highlight = pickHighlightNav(
        vob.start_sector,
        vob.last_sector,
        navBySector,
      );
      var stillTime = timing && timing.still_time != null ? timing.still_time : 0;

      // Pure wipe/transition cells: mid-cell stills look like the previous menu
      // or a half-wipe. Viewer holds the last WebM frame instead.
      // Explicit still: null clears a prior URL on merge (see mergeMenuCellMaps).
      if (
        !cellNeedsStillPng({ highlight: highlight, still_time: stillTime })
      ) {
        try {
          if (fs.existsSync(imgFile)) {
            fs.unlinkSync(imgFile);
          }
        } catch (e) {
          // ignore
        }
        entry.still = null;
        finishCell();
        return;
      }

      if (cellBytes < MIN_CELL_BYTES) {
        console.warn(
          'Tiny menu cell — placeholder still',
          path.basename(imgFile),
          '(' + cellBytes + ' bytes)',
        );
        writeStillPlaceholder(imgFile, stillLabel, 720, stillHeight);
        entry.still = stillUrl;
        finishCell();
        return;
      }

      var seek = resolveMenuStillSeek({
        cellStartSector: vob.start_sector,
        cellLastSector: vob.last_sector,
        highlight: highlight,
        timing: timing,
      });

      extractAuthoredStillPng(inputFile, seek, imgFile, start, end, function (ok) {
        if (ok) {
          entry.still = stillUrl;
          process.stdout.write('.');
        } else {
          console.warn(
            'No usable still for',
            path.basename(imgFile),
            '— writing placeholder',
          );
          try {
            fs.unlinkSync(imgFile);
          } catch (e) {
            // ignore
          }
          writeStillPlaceholder(imgFile, stillLabel, 720, stillHeight);
          entry.still = stillUrl;
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
   * Decode the authored still frame at the resolved seek (HLI PTS or cell start).
   * The cell is clipped to a temp VOB first so ffmpeg cannot bleed into the next
   * cell (HP last scene page → Special Features).
   */
  function extractAuthoredStillPng(
    vobFile,
    seek,
    imgFile,
    cellStartBytes,
    cellEndBytes,
    done,
  ) {
    var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvdjs-still-'));
    var outPng = path.join(tmpDir, 'still.png');
    var cellFile = path.join(tmpDir, 'cell.vob');
    var inputFile = vobFile;
    var skipBytes = seek.skipBytes;

    try {
      var length = cellEndBytes - cellStartBytes;
      if (length > 0 && Number.isFinite(cellStartBytes)) {
        var fd = fs.openSync(vobFile, 'r');
        var buf = Buffer.alloc(length);
        fs.readSync(fd, buf, 0, length, cellStartBytes);
        fs.closeSync(fd);
        fs.writeFileSync(cellFile, buf);
        inputFile = cellFile;
        skipBytes = cellRelativeSkipBytes(
          seek.skipBytes,
          cellStartBytes,
          cellEndBytes,
        );
      }
    } catch (e) {
      console.error(e);
      cleanupDir(tmpDir);
      done(false);
      return;
    }

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
      String(skipBytes),
      '-i',
      inputFile,
      '-ss',
      String(seek.ssSec || 0),
      '-map',
      '0:v:0',
      '-t',
      String(seek.durationSec),
      '-frames:v',
      String(seek.frameCount || 1),
      '-vf',
      'yadif=0:-1:0,format=rgb24',
      '-y',
      outPng,
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
      if (!isUsableStillPng(outPng)) {
        // Fall back: first frame of the clipped cell (no HLI skip).
        if (skipBytes !== 0 || (seek.ssSec || 0) !== 0) {
          tryFallbackFirstFrame(inputFile, outPng, function (ok) {
            if (ok && isUsableStillPng(outPng)) {
              try {
                fs.copyFileSync(outPng, imgFile);
                cleanupDir(tmpDir);
                done(true);
                return;
              } catch (e) {
                console.error(e);
              }
            }
            if (errBuf) {
              process.stderr.write(errBuf.slice(0, 500));
            }
            cleanupDir(tmpDir);
            done(false);
          });
          return;
        }
        if (errBuf) {
          process.stderr.write(errBuf.slice(0, 500));
        }
        cleanupDir(tmpDir);
        done(false);
        return;
      }

      try {
        fs.copyFileSync(outPng, imgFile);
        cleanupDir(tmpDir);
        done(true);
      } catch (e) {
        console.error(e);
        cleanupDir(tmpDir);
        done(false);
      }
    });
  }

  function tryFallbackFirstFrame(cellInput, outPng, done) {
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
      '-i',
      cellInput,
      '-map',
      '0:v:0',
      '-frames:v',
      '1',
      '-vf',
      'yadif=0:-1:0,format=rgb24',
      '-y',
      outPng,
    ];
    var child = spawn('ffmpeg', cmd);
    child.on('error', function () {
      done(false);
    });
    child.on('close', function (code) {
      done(code === 0);
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
