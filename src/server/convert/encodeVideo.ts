// Convert video to webm format.

'use strict';

import { loadJsonFile } from '../utils/loadJson.js';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import _ from 'lodash';

import * as serverUtils from '../../server/utils/index.js';
import { globFiles } from '../../server/utils/globFiles.js';

type EncodeVideoOptions = {
  full?: boolean;
};

/** VOBs smaller than this are placeholders / empty cells — skip encode. */
var MIN_VOB_BYTES = 64 * 1024;

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

  var dvdName = dvdPath.split(path.sep).pop();
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

      // Single-pass: DVD VOBs misreport duration so two-pass pass-1 often encodes 0 frames.
      var cmd = [
        '-hide_banner',
        '-analyzeduration', '200M',
        '-probesize', '100M',
        '-fflags', '+genpts+discardcorrupt',
        '-err_detect', 'ignore_err',
        '-i', input,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c:v', 'libvpx',
        '-b:v', '1000k',
        '-maxrate', '1500k',
        '-bufsize', '2000k',
        '-cpu-used', '4',
        '-deadline', 'good',
        '-auto-alt-ref', '0',
        '-c:a', 'libvorbis',
        '-b:a', '128k',
        '-ac', '2',
        '-force_key_frames', forceKeyFramesTimestamps.join(','),
        '-threads', '0',
        '-vf', 'yadif=0:-1:0,format=yuv420p',
        '-fps_mode', 'cfr',
        '-avoid_negative_ts', 'make_zero',
        '-y',
        output,
      ];

      console.log('ffmpeg', cmd.join(' '));

      runFfmpeg(cmd, function(code) {
        if (code !== 0) {
          console.error('ffmpeg failed (' + code + ') for', input);
        } else {
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
        finishOne();
      });

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
