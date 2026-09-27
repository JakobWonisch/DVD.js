// Generate catalogue cover.jpg from the best menu still.

'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';

import * as serverUtils from '../../server/utils/index.js';

var spawn = child_process.spawn;

/** Ignore tiny/gray failed stills when choosing a cover. */
var MIN_STILL_BYTES = 32 * 1024;

export default generateCover;

/**
 * Pick the best menu-*.png (prefer VMGM / domain 0) and write cover.jpg.
 *
 * @param {string} dvdPath
 * @param {function} callback
 */
function generateCover(dvdPath: string, callback) {
  process.stdout.write('\nGenerating cover image:\n');

  var webPath = serverUtils.getWebPath(dvdPath);
  var coverPath = path.join(webPath, 'cover.jpg');

  var stills;
  try {
    stills = fs
      .readdirSync(webPath)
      .filter(function (name) {
        return /^menu-\d+-\d+-\d+\.png$/i.test(name);
      })
      .map(function (name) {
        var full = path.join(webPath, name);
        var size = 0;
        try {
          size = fs.statSync(full).size;
        } catch (e) {
          size = 0;
        }
        var m = name.match(/^menu-(\d+)-/i);
        var domain = m ? parseInt(m[1], 10) : 99;
        return { name: name, full: full, size: size, domain: domain };
      })
      .filter(function (s) {
        return s.size >= MIN_STILL_BYTES;
      });
  } catch (e) {
    console.error(e);
    callback();
    return;
  }

  if (!stills.length) {
    console.warn('No usable menu stills for cover.jpg');
    callback();
    return;
  }

  // Prefer VMGM (domain 0) art, then largest file as a quality proxy.
  stills.sort(function (a, b) {
    if (a.domain !== b.domain) {
      return a.domain - b.domain;
    }
    return b.size - a.size;
  });

  var source = stills[0];
  console.log('Cover source:', source.name, '(' + source.size + ' bytes)');

  var cmd = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    source.full,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    '-y',
    coverPath,
  ];

  var child = spawn('ffmpeg', cmd);
  child.stderr.on('data', function (d) {
    process.stderr.write(d);
  });
  child.on('error', function (err) {
    console.error(err);
    callback();
  });
  child.on('close', function (code) {
    if (code !== 0) {
      console.error('ffmpeg failed to write cover.jpg (' + code + ')');
    } else {
      try {
        var outSize = fs.statSync(coverPath).size;
        process.stdout.write('Wrote cover.jpg (' + outSize + ' bytes)\n');
      } catch (e) {
        process.stdout.write('Wrote cover.jpg\n');
      }
    }
    callback();
  });
}
