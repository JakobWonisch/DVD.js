// Convert video to webm format.

'use strict';

import { loadJsonFile } from '../utils/loadJson.js';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import _ from 'lodash';

import * as serverUtils from '../../server/utils/index.js';
import editMetadataFile from '../../server/utils/editMetadataFile.js';
import * as utils from '../../utils.js';
import { globFiles } from '../../server/utils/globFiles.js';

type EncodeVideoOptions = {
  full?: boolean;
};

var spawn = child_process.spawn;
var getFileIndex = serverUtils.getFileIndex;
var getFileSuffix = serverUtils.getFileSuffix;
var isMenuVob = serverUtils.isMenuVob;

export default encodeVideo;

/**
 * Encode VOB files from a folder to webm.
 * @see https://trac.ffmpeg.org/wiki/vpxEncodingGuide
 * @see https://sites.google.com/a/webmproject.org/wiki/ffmpeg
 *
 * @todo At the end, delete the ffmpeg2pass-0.log file.
 * @todo Check for multiaudio/multiangle video and convert video and sound separately.
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

    // There are better ways to do async...
    function next(vobFile) {
      var output = serverUtils.convertVobPath(vobFile[0]);
      var passLogFile = path.join(vobFile[0].replace(/\/VIDEO_TS\/.+/i, '/'), 'ffmpeg2pass');
      var input = '';
      var index = getFileIndex(vobFile[0]);
      var forceKeyFramesTimestamps = [0];

      // Menu and video are optional. We use arrays here as we can then simply
      // iterate in the template without the need of a heavier logic.
      if (filesList[index] === undefined) {
        filesList[index] = {};
        filesList[index].index = [];
        filesList[index].video = [];
        filesList[index].extractMode = extractMode;
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

      input = input.replace(' ', '\ ');
      passLogFile = passLogFile.replace(' ', '\ ');
      output = output.replace(' ', '\ ');

      var pass1Cmd = [
        '-i', input,
        '-pass', '1',
        '-passlogfile', passLogFile,
        // Video
        '-c:v', 'libvpx',
        '-b:v', '1000k',
        // Audio
        '-c:a', 'libvorbis',
        '-b:a', '128k',
        // libvpx options
        '-cpu-used', '0',
        '-lag-in-frames', '16',
        '-quality', 'best',
        '-qmin', '0',
        '-qmax', '51',
        // ffmpeg options
        '-force_key_frames', forceKeyFramesTimestamps.join(','),
        '-bufsize', '500k',
        '-threads', '16',
        '-vf', 'yadif=1:1:1', // Deinterlace
        '-an', // Disable audio for pass 1.
        '-f', 'rawvideo',
        '-y', // Overwrite by default.
        'NUL' // /dev/null
      ];

      var pass2Cmd = [
        '-i', input,
        '-pass', '2',
        '-passlogfile', passLogFile,
        // Video
        '-c:v', 'libvpx',
        '-b:v', '1000k',
        // Audio
        '-c:a', 'libvorbis',
        '-b:a', '128k',
        // libvpx options
        '-cpu-used', '0',
        '-lag-in-frames', '16',
        '-quality', 'best',
        '-qmin', '0',
        '-qmax', '51',
        // libvpx options for pass 2
        '-auto-alt-ref', '1',
        '-maxrate', '1000k',  // pass 2
        // ffmpeg options
        '-force_key_frames', forceKeyFramesTimestamps.join(','),
        '-bufsize', '500k',
        '-threads', '16',
        '-vf', 'yadif=1:1:1', // Deinterlace
        '-y', // Overwrite by default.
        output
      ];

      console.log(pass1Cmd.join(' '));
      console.log(pass2Cmd.join(' '));

      var pass1 = spawn('ffmpeg', pass1Cmd);

      pass1.stdout.on('data', function(data) {
        process.stdout.write(data);
      });

      pass1.stderr.on('data', function(data) {
        process.stderr.write(data);
      });

      pass1.on('error', function(err) {
        console.error(err);
      });

      pass1.on('close', function() {
        var pass2 = spawn('ffmpeg', pass2Cmd);

        pass2.stdout.on('data', function(data) {
          process.stdout.write(data);
        });

        pass2.stderr.on('data', function(data) {
          process.stderr.write(data);
        });

        pass2.on('error', function(err) {
          console.error(err);
        });

        pass2.on('close', function() {
          // Next iteration.
          pointer++;
          if (pointer < vobFiles.length) {
            setTimeout(function() {
              next(vobFiles[pointer]);
            }, 0);
          } else {
            stampAndSave(filesList, callback);
          }
        });
      });
    }
  });

  function stampAndSave(filesList, done) {
    filesList.forEach(function(entry) {
      if (entry) {
        entry.extractMode = extractMode;
      }
    });
    // Ensure at least one entry carries extractMode for menu-only discs with no VOBs.
    if (!filesList.length) {
      filesList[0] = { index: [], video: [], extractMode: extractMode };
    } else if (!filesList[0]) {
      filesList[0] = { index: [], video: [], extractMode: extractMode };
    }
    editMetadataFile(getWebName('metadata'), filesList, function() {
      done();
    });
  }

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
