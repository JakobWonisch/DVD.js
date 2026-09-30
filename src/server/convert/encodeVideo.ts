// Convert video to webm format.

'use strict';

import { loadJsonFile } from '../utils/loadJson.js';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as child_process from 'node:child_process';
import _ from 'lodash';

import * as serverUtils from '../../server/utils/index.js';
import { globFiles } from '../../server/utils/globFiles.js';
import {
  buildMenuEncodeSegments,
  clipVobByteRange,
  menuForceKeyFrameTimes,
  type MenuEncodeSegment,
} from './menuEncodeSegments.js';
import {
  TITLE_INCLUDE_MAX_SEC,
} from './titleIncludePolicy.js';
import {
  buildShortTitleEncodePlan,
  type TitleEncodeSegment,
  type TitlePgcMedia,
} from './titleCellSegments.js';

type EncodeVideoOptions = {
  full?: boolean;
  /** When true, pass through full ffmpeg stderr. Default: errors + progress only. */
  verbose?: boolean;
};

/** VOBs smaller than this are placeholders / empty cells — skip encode. */
var MIN_VOB_BYTES = 64 * 1024;

/** High byte entropy with intact pack headers often means CSS still encrypted. */
var CSS_LIKE_ENTROPY = 7.85;

var spawn = child_process.spawn;
var getFileIndex = serverUtils.getFileIndex;
var isMenuVob = serverUtils.isMenuVob;

export default encodeVideo;

/**
 * Encode VOB files from a folder to webm (single-pass libvpx).
 *
 * DVD MPEG-PS often reports nonsense durations; we encode until EOF and do not
 * rely on two-pass stats (pass 1 frequently sees 0 frames on short/misprobed VOBs).
 *
 * Menu VOBs: clip each cell's byte range, encode exact duration with that
 * cell's audio, and write one WebM per cell (`menu-{domain}-{cell}-{vob}.webm`).
 * The viewer plays each clip from t=0 — no concat timeline / mid-file seeks
 * (those drifted and mixed language clips on Shrek).
 *
 * @param {string} dvdPath
 * @param {ConvertOptions|function} optionsOrCallback  Convert options, or callback (legacy).
 * @param {function} [callback]
 */
function encodeVideo(dvdPath: string, optionsOrCallback, callback?) {
  var options: EncodeVideoOptions = { full: false };
  if (typeof optionsOrCallback === 'function') {
    callback = optionsOrCallback;
  } else if (optionsOrCallback) {
    options = optionsOrCallback;
  }
  if (typeof callback !== 'function') {
    throw new Error('encodeVideo: callback required');
  }

  var extractMode = options.full ? 'full' : 'menus';
  process.stdout.write(
    extractMode === 'full'
      ? '\nEncoding VOB files (full):\n'
      : '\nEncoding VOB files (menus + titles ≤ ' +
          TITLE_INCLUDE_MAX_SEC +
          's):\n'
  );

  var dvdName = serverUtils.getDiscId(dvdPath);
  var webPath = serverUtils.getWebPath(dvdPath);

  var metadataPath = getWebName('metadata');
  var metadata = loadJsonFile(metadataPath);

  var vobPath = path.join(dvdPath, 'VIDEO_TS', '*.VOB');
  globFiles(vobPath, function(err, vobFilesList) {
    if (err) {
      console.error(err);
    }

    // Menus-only still considers title VOBs; duration gate runs per group below.
    if (!vobFilesList || !vobFilesList.length) {
      console.log('No VOB files to encode.');
      stampAndSave([], function() {
        callback();
      });
      return;
    }

    // Group by video (e.g. All VTS_01_xx.VOB together).
    var vobFilesGrouped = _.groupBy(vobFilesList, function(vobFile) {
      return vobFile.replace(/_[1-9]\.VOB/i, '.VOB');
    });

    // Retain the values only.
    var vobFiles = _.values(vobFilesGrouped);

    // Sort the files.
    vobFiles = _.forEach(vobFiles, function(vobFile) {
      return vobFile.sort(function(a: string, b: string) {
        return a.localeCompare(b);
      });
    });

    var filesList = [];
    var pointer = 0;

    next(vobFiles[pointer]);

    function next(vobFile) {
      var output = serverUtils.convertVobPath(vobFile[0]);
      var input = '';
      var index = getFileIndex(vobFile[0]);
      var forceKeyFramesTimestamps = [0];

      if (filesList[index] === undefined) {
        filesList[index] = {};
        filesList[index].index = [];
        filesList[index].video = [];
        filesList[index].extractMode = extractMode;
      }

      var totalBytes = vobFile.reduce(function(sum, file) {
        try {
          return sum + fs.statSync(file).size;
        } catch (e) {
          return sum;
        }
      }, 0);

      if (totalBytes < MIN_VOB_BYTES) {
        console.log('Skipping tiny/empty VOB group (' + totalBytes + ' bytes):', vobFile[0]);
        finishOne();
        return;
      }

      var menuVob = isMenuVob(vobFile[0]);
      var titlePlan: {
        segments: TitleEncodeSegment[];
        titlePgcMedia: TitlePgcMedia;
      } | null = null;

      if (!menuVob && !options.full) {
        var ifoJson = readTitleIfoJson(index);
        titlePlan = buildShortTitleEncodePlan(
          ifoJson || {},
          vobFile,
          TITLE_INCLUDE_MAX_SEC,
        );
        if (!titlePlan.segments.length) {
          console.log(
            'Skipping title VOB group (no title PGC with all cells ≤ ' +
              TITLE_INCLUDE_MAX_SEC +
              's by VOB PTS):',
            vobFile[0],
          );
          // Keep stubs from generateTitleStubs; mark no short cells included.
          filesList[index].titlePgcMedia = mergeTitlePgcMedia(
            metadata[index] && metadata[index].titlePgcMedia,
            { includedPgcs: [], pgcTimeline: {} },
          );
          finishOne();
          return;
        }
        console.log(
          'Including short title cell segment(s) (' +
            titlePlan.segments.length +
            ' cell(s), PGCs ' +
            titlePlan.titlePgcMedia.includedPgcs.join(',') +
            ' ≤ ' +
            TITLE_INCLUDE_MAX_SEC +
            's):',
          path.basename(vobFile[0]),
        );
        filesList[index].titlePgcMedia = mergeTitlePgcMedia(
          metadata[index] && metadata[index].titlePgcMedia,
          titlePlan.titlePgcMedia,
        );
      }

      warnIfCssLike(vobFile[0]);

      var menuSegments: MenuEncodeSegment[] = [];
      if (isMenuVob(vobFile[0]) && metadata[index] && metadata[index].menuCell) {
        menuSegments = buildMenuEncodeSegments(metadata[index].menuCell);
        if (menuSegments.length) {
          forceKeyFramesTimestamps = menuForceKeyFrameTimes(menuSegments);
        }
      }

      // Menu VOBs: per-cell WebMs only. Never write domain VIDEO_TS.webm /
      // VTS_*_0.webm (concat timelines drift and mix language audio).
      var usePerCellMenu =
        menuVob && menuSegments.length > 0 && vobFile.length === 1;
      if (!menuVob) {
        filesList[index].video.push(
          '/' + dvdName + '/' + path.basename(output),
        );
      }

      if (vobFile.length === 1) {
        input = path.normalize(vobFile[0]);
      } else {
        input = 'concat:' + vobFile.map(function(file) {
          return path.normalize(file);
        }).join('|');
      }

      if (
        !menuVob &&
        metadata[index] &&
        metadata[index].forceKeyFrames &&
        metadata[index].forceKeyFrames.length
      ) {
        forceKeyFramesTimestamps = metadata[index].forceKeyFrames;
      }

      // Menu cells: one WebM per cell (viewer plays from t=0).
      if (usePerCellMenu && fs.existsSync(input)) {
        encodeMenuCellWebms(input, index, menuSegments, function(_code, cellVideos) {
          filesList[index].menuCellVideos = cellVideos || {};
          filesList[index].replaceMenuCellVideos = true;
          // Drop any leftover domain concat WebM from older converts.
          try {
            if (fs.existsSync(output)) {
              fs.unlinkSync(output);
            }
          } catch (e) {
            // ignore
          }
          finishOne();
        });
        return;
      }

      if (menuVob) {
        console.warn(
          'Skipping menu VOB encode (need per-cell segments from menuCell):',
          path.basename(vobFile[0]),
          menuSegments.length
            ? '(multi-file VOB group unsupported)'
            : '(no menuCell segments)',
        );
        filesList[index].replaceMenuCellVideos = true;
        filesList[index].menuCellVideos = filesList[index].menuCellVideos || {};
        try {
          if (fs.existsSync(output)) {
            fs.unlinkSync(output);
          }
        } catch (e) {
          // ignore
        }
        finishOne();
        return;
      }

      // Menus mode: encode only short title cells (VOB PTS ≤ cap) as segments.
      if (
        !options.full &&
        titlePlan &&
        titlePlan.segments.length > 0
      ) {
        encodeTitleCellSegments(titlePlan.segments, output, function(code) {
          if (code !== 0) {
            console.warn(
              'Short title segment encode failed; omitting title media for',
              path.basename(vobFile[0]),
            );
            // Drop the video path we already pushed — media is missing.
            filesList[index].video = (filesList[index].video || []).filter(
              function(p) {
                return p !== '/' + dvdName + '/' + path.basename(output);
              },
            );
            filesList[index].titlePgcMedia = mergeTitlePgcMedia(
              metadata[index] && metadata[index].titlePgcMedia,
              { includedPgcs: [], pgcTimeline: {} },
            );
            try {
              if (fs.existsSync(output)) {
                fs.unlinkSync(output);
              }
            } catch (e) {
              // ignore
            }
          }
          finishOne();
        });
        return;
      }

      // --full title VOBs (or menus-mode titles that somehow reached here).
      encodeWholeVob(input, output, forceKeyFramesTimestamps, finishOne);

      function finishOne() {
        pointer++;
        if (pointer < vobFiles.length) {
          setTimeout(function() {
            next(vobFiles[pointer]);
          }, 0);
        } else {
          stampAndSave(filesList, callback);
        }
      }
    }
  });

  /**
   * @param padToDuration When true, freeze the last frame until `-t` cuts so
   *   still/short cells match IFO playback_time (Shrek: hundreds of 0.48s
   *   stills encode as one frame without this → WebM timeline drifts and
   *   German menus seek into the wrong clip).
   */
  function libvpxVideoArgs(padToDuration?: boolean) {
    var vf = padToDuration
      ? 'yadif=0:-1:0,format=yuv420p,tpad=stop_mode=clone:stop_duration=3600'
      : 'yadif=0:-1:0,format=yuv420p';
    return [
      '-c:v', 'libvpx',
      '-b:v', '1000k',
      '-maxrate', '1500k',
      '-bufsize', '2000k',
      '-cpu-used', '4',
      '-deadline', 'good',
      '-auto-alt-ref', '0',
      '-threads', '0',
      '-vf', vf,
      '-fps_mode', 'cfr',
      '-avoid_negative_ts', 'make_zero',
    ];
  }

  function encodeWholeVob(input, output, forceKeyFramesTimestamps, done) {
    var cmd = [
      '-hide_banner',
      ...(options.verbose ? [] : ['-loglevel', 'error', '-stats']),
      '-analyzeduration', '200M',
      '-probesize', '100M',
      '-fflags', '+genpts+discardcorrupt',
      '-err_detect', 'ignore_err',
      '-i', input,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      ...libvpxVideoArgs(),
      '-c:a', 'libvorbis',
      '-b:a', '128k',
      '-ac', '2',
      '-af', 'aresample=async=1:first_pts=0',
      '-force_key_frames', forceKeyFramesTimestamps.join(','),
      '-y',
      output,
    ];

    console.log('ffmpeg', cmd.join(' '));

    runFfmpeg(cmd, function(code) {
      reportOutput(code, input, output);
      done();
    });
  }

  /**
   * Encode each menu cell to its own WebM under webFolder.
   * Returns map "cellId:vobId" → "/disc/menu-d-c-v.webm".
   * Failed cells are skipped (logged); remaining cells still encode — never
   * abort the domain into a concat fallback.
   */
  function encodeMenuCellWebms(
    input: string,
    domainIndex: number,
    segments: MenuEncodeSegment[],
    done: (
      code: number,
      cellVideos?: Record<string, string>,
    ) => void,
  ) {
    var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvd-menu-archive-menu-enc-'));
    var cellVideos: Record<string, string> = {};
    var failures = 0;
    var i = 0;

    process.stdout.write(
      'Encoding ' +
        segments.length +
        ' per-cell menu WebM(s) for ' +
        path.basename(input) +
        ':\n',
    );

    encodeNext();

    function skipCell(label: string, reason: string) {
      failures++;
      console.warn('Skipping menu cell ' + label + ': ' + reason);
      try {
        // Drop a partial/corrupt output from this or a prior attempt.
        var outName =
          'menu-' +
          domainIndex +
          '-' +
          segments[i].cellId +
          '-' +
          segments[i].vobId +
          '.webm';
        var segOut = path.join(webPath, outName);
        if (fs.existsSync(segOut)) {
          fs.unlinkSync(segOut);
        }
      } catch (e) {
        // ignore
      }
      i++;
      setTimeout(encodeNext, 0);
    }

    function encodeNext() {
      if (i >= segments.length) {
        cleanupDir(tmpDir);
        if (failures > 0) {
          console.warn(
            'Per-cell menu encode finished with ' +
              failures +
              ' skipped cell(s) for ' +
              path.basename(input) +
              ' (no concat fallback)',
          );
        }
        done(failures > 0 && Object.keys(cellVideos).length === 0 ? 1 : 0, cellVideos);
        return;
      }

      var seg = segments[i];
      var cellVob = path.join(
        tmpDir,
        'cell-' + String(i).padStart(3, '0') + '.vob',
      );
      var videoOnly = path.join(
        tmpDir,
        'vid-' + String(i).padStart(3, '0') + '.webm',
      );
      var outName =
        'menu-' + domainIndex + '-' + seg.cellId + '-' + seg.vobId + '.webm';
      var segOut = path.join(webPath, outName);
      var url = '/' + dvdName + '/' + outName;
      if (!clipVobByteRange(input, seg.skipBytes, seg.endBytes, cellVob)) {
        skipCell(seg.label, 'clip failed');
        return;
      }

      var videoCmd = [
        '-hide_banner',
        ...(options.verbose ? [] : ['-loglevel', 'error', '-stats']),
        '-analyzeduration', '50M',
        '-probesize', '20M',
        '-fflags', '+genpts+discardcorrupt',
        '-err_detect', 'ignore_err',
        '-i', cellVob,
        '-t', String(seg.durationSec),
        '-map', '0:v:0',
        '-an',
        ...libvpxVideoArgs(true),
        '-force_key_frames', '0',
        '-y',
        videoOnly,
      ];

      console.log(
        '  cell ' +
          seg.label +
          ' → ' +
          outName +
          ' (' +
          seg.durationSec.toFixed(3) +
          's)',
      );

      runFfmpeg(videoCmd, function(vCode) {
        if (vCode !== 0) {
          skipCell(seg.label, 'ffmpeg video encode failed');
          return;
        }
        try {
          if (fs.statSync(videoOnly).size < 256) {
            skipCell(seg.label, 'empty video segment');
            return;
          }
        } catch (e) {
          skipCell(seg.label, 'missing video segment');
          return;
        }
        muxCellAudio(cellVob, videoOnly, segOut, seg.durationSec, function() {
          try {
            fs.unlinkSync(cellVob);
            fs.unlinkSync(videoOnly);
          } catch (e) {
            // ignore
          }
          try {
            if (fs.statSync(segOut).size < 256) {
              skipCell(seg.label, 'empty cell WebM');
              return;
            }
          } catch (e) {
            skipCell(seg.label, 'missing cell WebM');
            return;
          }
          cellVideos[seg.cellId + ':' + seg.vobId] = url;
          process.stdout.write('Wrote ' + segOut + '\n');
          i++;
          setTimeout(encodeNext, 0);
        });
      });
    }
  }

  /**
   * Mux audio from a clipped cell VOB under video. Pad audio to the video
   * length (`apad` + `-shortest`) so Vorbis overrun cannot inflate duration.
   */
  function muxCellAudio(
    cellVob: string,
    videoOnly: string,
    output: string,
    durationSec: number,
    done: () => void,
  ) {
    var withAudio = [
      '-hide_banner',
      ...(options.verbose ? [] : ['-loglevel', 'error', '-stats']),
      '-analyzeduration', '50M',
      '-probesize', '20M',
      '-fflags', '+genpts+discardcorrupt',
      '-err_detect', 'ignore_err',
      '-i', videoOnly,
      '-i', cellVob,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'libvorbis',
      '-b:a', '128k',
      '-ac', '2',
      '-af', 'aresample=async=1:first_pts=0,apad',
      '-shortest',
      '-t', String(durationSec),
      '-y',
      output,
    ];
    runFfmpeg(withAudio, function(code) {
      if (code === 0) {
        done();
        return;
      }
      var withSilence = [
        '-hide_banner',
        ...(options.verbose ? [] : ['-loglevel', 'error']),
        '-i', videoOnly,
        '-f', 'lavfi',
        '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy',
        '-c:a', 'libvorbis',
        '-b:a', '64k',
        '-shortest',
        '-t', String(durationSec),
        '-y',
        output,
      ];
      runFfmpeg(withSilence, function(sCode) {
        if (sCode === 0) {
          done();
          return;
        }
        try {
          fs.copyFileSync(videoOnly, output);
        } catch (e) {
          console.error(e);
        }
        done();
      });
    });
  }

  function concatSegments(segPaths: string[], output: string, done) {
    if (!segPaths.length) {
      done(1);
      return;
    }
    if (segPaths.length === 1) {
      try {
        fs.copyFileSync(segPaths[0], output);
        done(0);
      } catch (e) {
        console.error(e);
        done(1);
      }
      return;
    }

    var listFile = path.join(path.dirname(segPaths[0]), 'concat.txt');
    var listBody = segPaths
      .map(function(p) {
        return "file '" + p.replace(/'/g, "'\\''") + "'";
      })
      .join('\n');
    try {
      fs.writeFileSync(listFile, listBody);
    } catch (e) {
      console.error(e);
      done(1);
      return;
    }

    var cmd = [
      '-hide_banner',
      ...(options.verbose ? [] : ['-loglevel', 'error']),
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      '-y',
      output,
    ];
    console.log('ffmpeg concat', segPaths.length, 'segments →', path.basename(output));
    runFfmpeg(cmd, function(code) {
      try {
        fs.unlinkSync(listFile);
      } catch (e) {
        // ignore
      }
      done(code);
    });
  }

  /**
   * Encode short title cells with A/V per segment, then concat.
   * Sparse cells cannot reuse menu mux-from-whole-VOB (wrong audio).
   */
  function encodeTitleCellSegments(
    segments: TitleEncodeSegment[],
    output: string,
    done: (code: number) => void,
  ) {
    var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvd-menu-archive-title-enc-'));
    var segPaths: string[] = [];
    var i = 0;

    process.stdout.write(
      'Encoding ' + segments.length + ' short title cell segment(s):\n',
    );

    encodeNext();

    function encodeNext() {
      if (i >= segments.length) {
        concatSegments(segPaths, output, function(code) {
          cleanupDir(tmpDir);
          if (code === 0) {
            reportOutput(0, segments[0].inputPath, output);
          }
          done(code);
        });
        return;
      }

      var seg = segments[i];
      var cellVob = path.join(
        tmpDir,
        'cell-' + String(i).padStart(3, '0') + '.vob',
      );
      var segOut = path.join(
        tmpDir,
        'seg-' + String(i).padStart(3, '0') + '.webm',
      );
      if (
        !clipVobByteRange(seg.inputPath, seg.skipBytes, seg.endBytes, cellVob)
      ) {
        console.error('Failed to clip title cell', seg.label);
        cleanupDir(tmpDir);
        done(1);
        return;
      }
      var cmd = [
        '-hide_banner',
        ...(options.verbose ? [] : ['-loglevel', 'error', '-stats']),
        '-analyzeduration', '50M',
        '-probesize', '20M',
        '-fflags', '+genpts+discardcorrupt',
        '-err_detect', 'ignore_err',
        '-i', cellVob,
        '-t', String(seg.durationSec),
        '-map', '0:v:0',
        '-map', '0:a:0?',
        ...libvpxVideoArgs(true),
        '-c:a', 'libvorbis',
        '-b:a', '128k',
        '-ac', '2',
        '-af', 'aresample=async=1:first_pts=0',
        '-force_key_frames', '0',
        '-y',
        segOut,
      ];

      console.log(
        '  title cell ' +
          seg.label +
          ' t=' +
          seg.durationSec.toFixed(3) +
          's',
      );

      runFfmpeg(cmd, function(code) {
        try {
          fs.unlinkSync(cellVob);
        } catch (e) {
          // ignore
        }
        if (code !== 0) {
          console.error('ffmpeg title segment failed for cell', seg.label);
          cleanupDir(tmpDir);
          done(code);
          return;
        }
        try {
          if (fs.statSync(segOut).size < 256) {
            console.error('ffmpeg produced empty title segment for', seg.label);
            cleanupDir(tmpDir);
            done(1);
            return;
          }
        } catch (e) {
          cleanupDir(tmpDir);
          done(1);
          return;
        }
        segPaths.push(segOut);
        i++;
        setTimeout(encodeNext, 0);
      });
    }
  }

  function reportOutput(code, input, output) {
    if (code !== 0) {
      console.error('ffmpeg failed (' + code + ') for', input);
      return;
    }
    try {
      var outSize = fs.statSync(output).size;
      if (outSize < 1024) {
        console.error('ffmpeg produced tiny output (' + outSize + ' bytes):', output);
      } else {
        process.stdout.write('Wrote ' + output + ' (' + outSize + ' bytes)\n');
      }
    } catch (e) {
      console.error('ffmpeg reported success but output missing:', output);
    }
  }

  function cleanupDir(dir) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  }

  function runFfmpeg(args, done) {
    var child = spawn('ffmpeg', args);

    child.stdout.on('data', function(data) {
      process.stdout.write(data);
    });

    child.stderr.on('data', function(data) {
      process.stderr.write(data);
    });

    child.on('error', function(err) {
      console.error(err);
      done(1);
    });

    child.on('close', function(code) {
      done(code === null ? 1 : code);
    });
  }

  /**
   * CSS-scrambled VOB payloads keep MPEG pack headers but look nearly random.
   * Encoding them yields gray/blocky menus; warn so the rip can be re-done.
   */
  function warnIfCssLike(vobPath) {
    try {
      var fd = fs.openSync(vobPath, 'r');
      var buf = Buffer.alloc(2048 * 16);
      fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      var packs = 0;
      for (var i = 0; i + 4 <= buf.length; i += 2048) {
        if (
          buf[i] === 0 &&
          buf[i + 1] === 0 &&
          buf[i + 2] === 1 &&
          buf[i + 3] === 0xba
        ) {
          packs++;
        }
      }
      var freq = new Map();
      for (var j = 0; j < buf.length; j++) {
        freq.set(buf[j], (freq.get(buf[j]) || 0) + 1);
      }
      var entropy = 0;
      freq.forEach(function(count) {
        var p = count / buf.length;
        entropy -= p * Math.log2(p);
      });
      if (packs >= 8 && entropy >= CSS_LIKE_ENTROPY) {
        console.warn(
          'Warning: ' +
            path.basename(vobPath) +
            ' looks CSS-encrypted or badly decrypted ' +
            '(entropy ' +
            entropy.toFixed(2) +
            '). Expect gray/artifact menus — re-rip with CSS removal.'
        );
      }
    } catch (e) {
      // ignore probe failures
    }
  }

  function stampAndSave(filesList, done) {
    filesList.forEach(function(entry) {
      if (entry) {
        entry.extractMode = extractMode;
        if (!Array.isArray(entry.index)) {
          entry.index = [];
        }
        if (!Array.isArray(entry.video)) {
          entry.video = [];
        }
        // Menus mode: entry.video only lists short titles encoded this run
        // (long titles were skipped before push). Replacing content[i].video
        // below clears stale --full paths for domains we touched.
      }
    });
    if (!filesList.length) {
      filesList[0] = { index: [], video: [], extractMode: extractMode };
    } else if (!filesList[0]) {
      filesList[0] = { index: [], video: [], extractMode: extractMode };
    }

    // _.merge() concatenates/keeps prior array slots; replace index/video explicitly.
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

    filesList.forEach(function(entry, i) {
      if (!entry) {
        return;
      }
      if (!content[i]) {
        content[i] = {};
      }
      content[i].index = entry.index.slice();
      content[i].video = entry.video.slice();
      content[i].extractMode = entry.extractMode;
      if (entry.replaceMenuCellVideos) {
        // Full replace: clear prior stamps so reconvert never keeps orphans
        // that point at missing menu-*.webm after a skipped cell.
        clearMenuCellVideoStamps(content[i].menuCell);
      }
      if (entry.menuCellVideos && typeof entry.menuCellVideos === 'object') {
        if (!content[i].menuCell) {
          content[i].menuCell = {};
        }
        Object.keys(entry.menuCellVideos).forEach(function(key) {
          var parts = String(key).split(':');
          var cellId = parts[0];
          var vobId = parts[1];
          if (!cellId || !vobId) {
            return;
          }
          if (!content[i].menuCell[cellId]) {
            content[i].menuCell[cellId] = {};
          }
          if (!content[i].menuCell[cellId][vobId]) {
            content[i].menuCell[cellId][vobId] = {};
          }
          content[i].menuCell[cellId][vobId].video = entry.menuCellVideos[key];
        });
      }
      if (entry.titlePgcMedia) {
        content[i].titlePgcMedia = mergeTitlePgcMedia(
          content[i].titlePgcMedia,
          entry.titlePgcMedia,
        );
      } else if (!options.full) {
        // Menus mode: keep stubs from generateTitleStubs; clear only encode maps.
        if (
          content[i].titlePgcMedia &&
          content[i].titlePgcMedia.stubs &&
          Object.keys(content[i].titlePgcMedia.stubs).length
        ) {
          content[i].titlePgcMedia = mergeTitlePgcMedia(
            content[i].titlePgcMedia,
            { includedPgcs: [], pgcTimeline: {} },
          );
        } else {
          delete content[i].titlePgcMedia;
        }
      } else {
        delete content[i].titlePgcMedia;
      }
    });

    fs.writeFile(metaPath, JSON.stringify(content), function(err) {
      if (err) {
        console.error(err);
      }
      process.stdout.write('.');
      done();
    });
  }

  /**
   * Load VTS_XX_0.json for title-cell planning (domain 0 = VMGM → null).
   */
  function readTitleIfoJson(domainIndex: number): any | null {
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

  function getWebName(name: string): string {
    return path.join(webPath, getJsonFileName(name));
  }
}

/**
 * Preserve stubs from generateTitleStubs while updating includedPgcs / timeline.
 */
function mergeTitlePgcMedia(
  existing: TitlePgcMedia | null | undefined,
  next: TitlePgcMedia,
): TitlePgcMedia {
  var stubs =
    (next && next.stubs) ||
    (existing && existing.stubs) ||
    undefined;
  var pgcCells =
    (next && next.pgcCells) ||
    (existing && existing.pgcCells) ||
    undefined;
  var out: TitlePgcMedia = {
    includedPgcs: (next && next.includedPgcs) || [],
    pgcTimeline: (next && next.pgcTimeline) || {},
  };
  if (pgcCells && Object.keys(pgcCells).length) {
    // Drop cell maps for PGCs that are no longer included.
    var included = new Set(out.includedPgcs);
    var keptCells: NonNullable<TitlePgcMedia['pgcCells']> = {};
    Object.keys(pgcCells).forEach(function (k) {
      if (included.has(Number(k))) {
        keptCells[k] = pgcCells[k];
      }
    });
    if (Object.keys(keptCells).length) {
      out.pgcCells = keptCells;
    }
  }
  if (stubs && Object.keys(stubs).length) {
    // Drop stubs for PGCs that are now included as short-cell WebMs.
    var included2 = new Set(out.includedPgcs);
    var kept: NonNullable<TitlePgcMedia['stubs']> = {};
    Object.keys(stubs).forEach(function (k) {
      if (!included2.has(Number(k))) {
        kept[k] = stubs[k];
      }
    });
    if (Object.keys(kept).length) {
      out.stubs = kept;
    }
  }
  return out;
}

/** Drop menuCell[].video so reconvert does not keep URLs for skipped cells. */
function clearMenuCellVideoStamps(menuCell: any): void {
  if (!menuCell || typeof menuCell !== 'object') {
    return;
  }
  Object.keys(menuCell).forEach(function (cellId) {
    var vobs = menuCell[cellId];
    if (!vobs || typeof vobs !== 'object') {
      return;
    }
    Object.keys(vobs).forEach(function (vobId) {
      if (vobs[vobId] && typeof vobs[vobId] === 'object') {
        delete vobs[vobId].video;
      }
    });
  });
}

function getJsonFileName(name: string): string {
  return name.replace(/\.IFO$/i, '') + '.json';
}
