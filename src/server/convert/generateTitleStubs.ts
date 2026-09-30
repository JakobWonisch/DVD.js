/**
 * Menus-mode: classify omitted title PGCs and extract interactive stub stills /
 * button hitboxes so JumpTT stays navigable without feature WebMs.
 */

'use strict';

import { loadJsonFile } from '../utils/loadJson.js';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import * as os from 'node:os';

import * as serverUtils from '../../server/utils/index.js';
import { globFiles } from '../../server/utils/globFiles.js';
import editMetadataFile from '../../server/utils/editMetadataFile.js';
import { writeStillPlaceholder } from './writeStillPlaceholder.js';
import {
  DVD_VIDEO_LB_LEN,
  cellRelativeSkipBytes,
  hliOffsetSecFromNav,
  isUsableStillPng,
  STILL_SEEK_FRAME_CANDIDATES,
  STILL_SEEK_WINDOW_SEC,
} from './menuStillSeek.js';
import {
  buildShortTitleEncodePlan,
  buildVobExtents,
  resolveLogicalSector,
} from './titleCellSegments.js';
import { TITLE_INCLUDE_MAX_SEC } from './titleIncludePolicy.js';
import {
  buildStubButtonsFromNav,
  classifyTitlePgcStubs,
  titleFrameHeightFromIfo,
  type InteractiveStubTarget,
  type TitleStubEntry,
  type TitleStubMap,
} from './titleStubs.js';

var spawn = child_process.spawn;

export default generateTitleStubs;

type DomainStubUpdate = {
  titlePgcMedia: {
    includedPgcs: number[];
    pgcTimeline: Record<string, { startSec: number; endSec: number }>;
    stubs: TitleStubMap;
  };
};

/**
 * @param {string} dvdPath
 * @param {{ full?: boolean }} options
 * @param {function} callback
 */
function generateTitleStubs(
  dvdPath: string,
  options: { full?: boolean },
  callback: () => void,
) {
  if (options && options.full) {
    callback();
    return;
  }

  process.stdout.write('\nGenerating title stubs (omitted PGCs):\n');

  var dvdName = serverUtils.getDiscId(dvdPath);
  var webPath = serverUtils.getWebPath(dvdPath);
  var metadataPath = path.join(webPath, 'metadata.json');
  var filesList = loadJsonFile(metadataPath);
  if (!Array.isArray(filesList)) {
    filesList = [];
  }

  var domainUpdates: Array<DomainStubUpdate | undefined> = [];
  var pointer = 0;
  nextDomain();

  function nextDomain() {
    if (pointer >= filesList.length) {
      editMetadataFile(metadataPath, domainUpdates, function () {
        process.stdout.write('\n');
        callback();
      });
      return;
    }

    var domainIndex = pointer;
    pointer++;

    if (domainIndex === 0) {
      setTimeout(nextDomain, 0);
      return;
    }

    var ifoJson = readTitleIfoJson(webPath, domainIndex);
    if (!ifoJson) {
      setTimeout(nextDomain, 0);
      return;
    }

    listTitleVobFiles(dvdPath, domainIndex, function (vobFiles) {
      var plan = buildShortTitleEncodePlan(
        ifoJson,
        vobFiles,
        TITLE_INCLUDE_MAX_SEC,
      );
      var classified = classifyTitlePgcStubs(
        ifoJson,
        vobFiles,
        plan.titlePgcMedia.includedPgcs,
      );
      var stubs = classified.stubs;

      extractInteractiveStubs(
        {
          domainIndex: domainIndex,
          dvdName: dvdName,
          webPath: webPath,
          ifoJson: ifoJson,
          vobFiles: vobFiles,
          targets: classified.interactive,
          stubs: stubs,
        },
        function () {
          var skipN = 0;
          var interactiveN = 0;
          Object.keys(stubs).forEach(function (k) {
            if (stubs[k].kind === 'interactive') {
              interactiveN++;
            } else {
              skipN++;
            }
          });
          if (interactiveN || skipN) {
            console.log(
              '  domain ' +
                domainIndex +
                ': ' +
                interactiveN +
                ' interactive stub(s), ' +
                skipN +
                ' skip stub(s), ' +
                plan.titlePgcMedia.includedPgcs.length +
                ' short PGC(s) included',
            );
          }
          domainUpdates[domainIndex] = {
            titlePgcMedia: {
              includedPgcs: plan.titlePgcMedia.includedPgcs.slice(),
              pgcTimeline: Object.assign({}, plan.titlePgcMedia.pgcTimeline),
              stubs: stubs,
            },
          };
          setTimeout(nextDomain, 0);
        },
      );
    });
  }
}

function extractInteractiveStubs(
  opts: {
    domainIndex: number;
    dvdName: string;
    webPath: string;
    ifoJson: any;
    vobFiles: string[];
    targets: InteractiveStubTarget[];
    stubs: TitleStubMap;
  },
  done: () => void,
) {
  var i = 0;
  step();

  function step() {
    if (i >= opts.targets.length) {
      done();
      return;
    }
    var target = opts.targets[i++];
    materializeInteractiveStub(opts, target, function () {
      process.stdout.write('.');
      setTimeout(step, 0);
    });
  }
}

function materializeInteractiveStub(
  opts: {
    domainIndex: number;
    dvdName: string;
    webPath: string;
    ifoJson: any;
    vobFiles: string[];
    stubs: TitleStubMap;
  },
  target: InteractiveStubTarget,
  done: () => void,
) {
  var cell = target.cell;
  var highlight = target.highlight;
  var hlGi =
    highlight.nav.pci &&
    highlight.nav.pci.hli &&
    highlight.nav.pci.hli.hl_gi;
  var btnit =
    highlight.nav.pci && highlight.nav.pci.hli
      ? (highlight.nav.pci.hli.btnit as Array<{ y_end?: number }>)
      : null;
  var frameHeight = titleFrameHeightFromIfo(
    opts.ifoJson,
    btnit,
    hlGi ? hlGi.btn_ns : 0,
  );
  var buttons = buildStubButtonsFromNav(highlight.nav, frameHeight);
  var cellID = cell.cellId;
  var vobID = cell.vobId;
  var imgName =
    'title-stub-' + opts.domainIndex + '-' + cellID + '-' + vobID + '.png';
  var cssName =
    'title-stub-' + opts.domainIndex + '-' + cellID + '-' + vobID + '.css';
  var imgFile = path.join(opts.webPath, imgName);
  var cssFile = path.join(opts.webPath, cssName);
  var stillUrl = '/' + opts.dvdName + '/' + imgName;
  var cssUrl = '/' + opts.dvdName + '/' + cssName;
  var stillLabel = opts.domainIndex + '-' + cellID + '-' + vobID;
  var stillTime = cellStillTime(
    opts.ifoJson,
    target.pgcIndex,
    cell.cellIndex,
  );

  var stub: TitleStubEntry = {
    kind: 'interactive',
    cellID: cellID,
    vobID: vobID,
    still: stillUrl,
    css: cssUrl,
    // Hold for user input when the authored still_time is 0.
    still_time: stillTime > 0 ? stillTime : 255,
    buttons: buttons,
    btn_nb: buttons.length,
  };

  var cssRules = buttons.map(function (btn) {
    return (
      `[data-domain="${opts.domainIndex}"][data-cell="${cellID}"][data-vob="${vobID}"] .btn[data-id="${btn.id}"]{` +
      btn.css +
      '}'
    );
  });
  try {
    fs.writeFileSync(cssFile, cssRules.join(''));
  } catch (e) {
    console.error(e);
  }

  var extents = buildVobExtents(opts.vobFiles);
  var startResolved = resolveLogicalSector(extents, cell.startSector);
  var endResolved = resolveLogicalSector(extents, cell.lastSector);
  var hliResolved = resolveLogicalSector(extents, target.highlightSector);

  function finish() {
    opts.stubs[String(target.pgcIndex)] = stub;
    done();
  }

  if (
    !startResolved ||
    !endResolved ||
    !hliResolved ||
    startResolved.path !== endResolved.path ||
    startResolved.path !== hliResolved.path
  ) {
    writeStillPlaceholder(imgFile, stillLabel, 720, frameHeight);
    finish();
    return;
  }

  var cellStartBytes = startResolved.sectorInFile * DVD_VIDEO_LB_LEN;
  var cellEndBytes = (endResolved.sectorInFile + 1) * DVD_VIDEO_LB_LEN;
  var absoluteSkip = hliResolved.sectorInFile * DVD_VIDEO_LB_LEN;
  var ssSec = hliOffsetSecFromNav(highlight.nav);
  var seek = {
    skipBytes: absoluteSkip,
    ssSec: ssSec,
    frameCount: STILL_SEEK_FRAME_CANDIDATES,
    durationSec: Math.max(STILL_SEEK_WINDOW_SEC, ssSec + 0.25),
  };

  extractTitleStubStill(
    startResolved.path,
    seek,
    imgFile,
    cellStartBytes,
    cellEndBytes,
    function (ok) {
      if (!ok) {
        writeStillPlaceholder(imgFile, stillLabel, 720, frameHeight);
      }
      finish();
    },
  );
}

function extractTitleStubStill(
  vobFile: string,
  seek: {
    skipBytes: number;
    ssSec: number;
    frameCount: number;
    durationSec: number;
  },
  imgFile: string,
  cellStartBytes: number,
  cellEndBytes: number,
  done: (ok: boolean) => void,
) {
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvd-menu-archive-title-stub-'));
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
  child.on('error', function () {
    cleanupDir(tmpDir);
    done(false);
  });
  child.on('close', function () {
    if (!isUsableStillPng(outPng)) {
      cleanupDir(tmpDir);
      done(false);
      return;
    }
    try {
      fs.copyFileSync(outPng, imgFile);
      cleanupDir(tmpDir);
      done(true);
    } catch (e) {
      cleanupDir(tmpDir);
      done(false);
    }
  });
}

function cellStillTime(
  ifoJson: any,
  pgcIndex: number,
  cellIndex: number,
): number {
  var srps = ifoJson && ifoJson.vts_pgcit && ifoJson.vts_pgcit.pgci_srp;
  var pgc = srps && srps[pgcIndex - 1] && srps[pgcIndex - 1].pgc;
  var playback = pgc && pgc.cell_playback && pgc.cell_playback[cellIndex];
  var st = playback && playback.still_time;
  return typeof st === 'number' ? st : 0;
}

function readTitleIfoJson(webPath: string, domainIndex: number): any | null {
  if (!(domainIndex > 0)) {
    return null;
  }
  var vts = String(domainIndex).padStart(2, '0');
  var ifoJsonPath = path.join(webPath, 'VTS_' + vts + '_0.json');
  try {
    if (!fs.existsSync(ifoJsonPath)) {
      return null;
    }
    return loadJsonFile(ifoJsonPath);
  } catch (e) {
    return null;
  }
}

function listTitleVobFiles(
  dvdPath: string,
  domainIndex: number,
  done: (files: string[]) => void,
) {
  var vts = String(domainIndex).padStart(2, '0');
  var pattern = path.join(dvdPath, 'VIDEO_TS', 'VTS_' + vts + '_[1-9].VOB');
  globFiles(pattern, function (err, files) {
    if (err || !files) {
      done([]);
      return;
    }
    files.sort(function (a, b) {
      return a.localeCompare(b);
    });
    done(files);
  });
}

function cleanupDir(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    // ignore
  }
}
