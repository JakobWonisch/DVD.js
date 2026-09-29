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
  menuForceKeyFrameTimes,
  type MenuEncodeSegment,
} from './menuEncodeSegments.js';

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
var getFileSuffix = serverUtils.getFileSuffix;
var isMenuVob = serverUtils.isMenuVob;

export default encodeVideo;

/**
 * Encode VOB files from a folder to webm (single-pass libvpx).
 *
 * DVD MPEG-PS often reports nonsense durations; we encode until EOF and do not
 * rely on two-pass stats (pass 1 frequently sees 0 frames on short/misprobed VOBs).
 *
 * Menu VOBs: encode each cell as an exact [startSec, endSec) segment (sector
 * skip + hard `-t`), then concat — avoids keyframe-seek bleed from prior cells.
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
      : '\nEncoding VOB files (menus only):\n'
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

    if (!options.full) {
      vobFilesList = (vobFilesList || []).filter(isMenuVob);
    }

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

      warnIfCssLike(vobFile[0]);

      if (getFileSuffix(vobFile[0]) === 0) {
        filesList[index].index.push('/' + dvdName + '/' + path.basename(output));
      } else {
        filesList[index].video.push('/' + dvdName + '/' + path.basename(output));
      }

      if (vobFile.length === 1) {
        input = path.normalize(vobFile[0]);
      } else {
        input = 'concat:' + vobFile.map(function(file) {
          return path.normalize(file);
        }).join('|');
      }

      if (metadata[index] && metadata[index].forceKeyFrames && metadata[index].forceKeyFrames.length) {
        forceKeyFramesTimestamps = metadata[index].forceKeyFrames;
      }

      var menuSegments: MenuEncodeSegment[] = [];
      if (isMenuVob(vobFile[0]) && metadata[index] && metadata[index].menuCell) {
        menuSegments = buildMenuEncodeSegments(metadata[index].menuCell);
        if (menuSegments.length) {
          forceKeyFramesTimestamps = menuForceKeyFrameTimes(menuSegments);
        }
      }

      // Menu cells: encode exact duration windows then concat (no seek bleed).
      if (
        isMenuVob(vobFile[0]) &&
        menuSegments.length > 0 &&
        vobFile.length === 1 &&
        fs.existsSync(input)
      ) {
        encodeMenuSegments(input, output, menuSegments, function(code) {
          if (code !== 0) {
            console.warn(
              'Menu segment encode failed; falling back to whole-VOB encode for',
              path.basename(input),
            );
            encodeWholeVob(input, output, forceKeyFramesTimestamps, finishOne);
          } else {
            finishOne();
          }
        });
        return;
      }

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

  function libvpxVideoArgs() {
    return [
      '-c:v', 'libvpx',
      '-b:v', '1000k',
      '-maxrate', '1500k',
      '-bufsize', '2000k',
      '-cpu-used', '4',
      '-deadline', 'good',
      '-auto-alt-ref', '0',
      '-threads', '0',
      '-vf', 'yadif=0:-1:0,format=yuv420p',
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
   * Encode each menu cell for exactly durationSec from its start sector, then
   * concat. Output timeline matches menuCell startSec/endSec used by the player.
   * Segments are video-only (consistent concat); audio is muxed from the VOB.
   */
  function encodeMenuSegments(input, output, segments: MenuEncodeSegment[], done) {
    var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvdjs-menu-enc-'));
    var segPaths: string[] = [];
    var i = 0;
    var totalDuration = segments.reduce(function(sum, s) {
      return sum + s.durationSec;
    }, 0);

    process.stdout.write(
      'Encoding ' +
        segments.length +
        ' menu cell segment(s) for ' +
        path.basename(input) +
        ':\n',
    );

    encodeNext();

    function encodeNext() {
      if (i >= segments.length) {
        var videoOnly = path.join(tmpDir, 'video.webm');
        concatSegments(segPaths, videoOnly, function(code) {
          if (code !== 0) {
            cleanupDir(tmpDir);
            done(code);
            return;
          }
          muxMenuAudio(input, videoOnly, output, totalDuration, function(muxCode) {
            cleanupDir(tmpDir);
            if (muxCode === 0) {
              reportOutput(0, input, output);
            }
            done(muxCode);
          });
        });
        return;
      }

      var seg = segments[i];
      var segOut = path.join(tmpDir, 'seg-' + String(i).padStart(3, '0') + '.webm');
      // Hard -t after sector skip: keep only this cell's dvd_time window.
      // Video-only so every segment has the same stream layout for concat.
      var cmd = [
        '-hide_banner',
        ...(options.verbose ? [] : ['-loglevel', 'error', '-stats']),
        '-analyzeduration', '50M',
        '-probesize', '20M',
        '-fflags', '+genpts+discardcorrupt',
        '-err_detect', 'ignore_err',
        '-skip_initial_bytes', String(seg.skipBytes),
        '-i', input,
        '-t', String(seg.durationSec),
        '-map', '0:v:0',
        '-an',
        ...libvpxVideoArgs(),
        '-force_key_frames', '0',
        '-y',
        segOut,
      ];

      console.log(
        '  cell ' +
          seg.label +
          ' t=' +
          seg.startSec.toFixed(3) +
          '-' +
          seg.endSec.toFixed(3) +
          's',
      );

      runFfmpeg(cmd, function(code) {
        if (code !== 0) {
          console.error('ffmpeg segment failed for cell', seg.label);
          cleanupDir(tmpDir);
          done(code);
          return;
        }
        try {
          if (fs.statSync(segOut).size < 256) {
            console.error('ffmpeg produced empty segment for cell', seg.label);
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

  /** Mux VOB audio under the precise video timeline (best-effort). */
  function muxMenuAudio(input, videoOnly, output, totalDuration, done) {
    var cmd = [
      '-hide_banner',
      ...(options.verbose ? [] : ['-loglevel', 'error', '-stats']),
      '-analyzeduration', '200M',
      '-probesize', '100M',
      '-fflags', '+genpts+discardcorrupt',
      '-err_detect', 'ignore_err',
      '-i', videoOnly,
      '-i', input,
      '-t', String(totalDuration),
      '-map', '0:v:0',
      '-map', '1:a:0?',
      '-c:v', 'copy',
      '-c:a', 'libvorbis',
      '-b:a', '128k',
      '-ac', '2',
      '-af', 'aresample=async=1:first_pts=0',
      '-shortest',
      '-y',
      output,
    ];
    runFfmpeg(cmd, function(code) {
      if (code === 0) {
        done(0);
        return;
      }
      // No usable audio — ship the precise video-only file.
      console.warn('Menu audio mux failed; keeping video-only WebM');
      try {
        fs.copyFileSync(videoOnly, output);
        done(0);
      } catch (e) {
        console.error(e);
        done(1);
      }
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
        // Menu-only: never keep stale title paths from a previous --full merge.
        if (!options.full) {
          entry.video = [];
        }
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
    });

    fs.writeFile(metaPath, JSON.stringify(content), function(err) {
      if (err) {
        console.error(err);
      }
      process.stdout.write('.');
      done();
    });
  }

  function getWebName(name: string): string {
    return path.join(webPath, getJsonFileName(name));
  }
}

function getJsonFileName(name: string): string {
  return name.replace(/\.IFO$/i, '') + '.json';
}
