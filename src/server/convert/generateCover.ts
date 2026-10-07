// Generate catalogue cover.jpg from the Play-title / main-menu still.

'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';

import * as serverUtils from '../../server/utils/index.js';
import { loadJsonFile } from '../utils/loadJson.js';
import { findPlayTitleCoverCells } from './findPlayTitleCoverCells.js';
import {
  parseMenuStillName,
  pickCoverStill,
  type CoverDomainMeta,
  type CoverPlayTitleCell,
  type CoverStillFile,
} from './pickCoverStill.js';

var spawn = child_process.spawn;

export default generateCover;

/**
 * Prefer the menu cell whose button starts the longest title; else VMGM
 * Title / Root; else the largest usable VMGM still.
 *
 * @param {string} dvdPath
 * @param {function} callback
 */
function generateCover(dvdPath: string, callback) {
  process.stdout.write('\nGenerating cover image:\n');

  var webPath = serverUtils.getWebPath(dvdPath);
  var coverPath = path.join(webPath, 'cover.jpg');
  var metaPath = path.join(webPath, 'metadata.json');

  var stills: CoverStillFile[] = [];
  try {
    stills = fs
      .readdirSync(webPath)
      .map(function (name) {
        var full = path.join(webPath, name);
        var size = 0;
        try {
          size = fs.statSync(full).size;
        } catch (e) {
          size = 0;
        }
        return parseMenuStillName(name, full, size);
      })
      .filter(function (s): s is CoverStillFile {
        return !!s;
      });
  } catch (e) {
    console.error(e);
    callback();
    return;
  }

  var metadata: CoverDomainMeta[] | null = null;
  try {
    if (fs.existsSync(metaPath)) {
      metadata = loadJsonFile(metaPath);
    }
  } catch (e) {
    console.warn('Could not read metadata.json for cover selection:', e);
    metadata = null;
  }

  var playTitleCells: CoverPlayTitleCell[] = [];
  try {
    var play = findPlayTitleCoverCells(webPath);
    playTitleCells = play.cells;
    if (play.main) {
      console.log(
        'Main title: TT',
        play.main.titleNr,
        'VTS',
        play.main.vts,
        'TTN',
        play.main.vtsTtn,
        '(' + Math.round(play.main.durationSec) + 's)',
        playTitleCells.length
          ? '— ' + playTitleCells.length + ' play-menu cell(s)'
          : '— no play-menu cell found',
      );
    }
  } catch (e) {
    console.warn('Play-title cover scan failed:', e);
    playTitleCells = [];
  }

  var source = pickCoverStill({
    stills: stills,
    metadata: metadata,
    playTitleCells: playTitleCells,
  });
  if (!source) {
    console.warn('No usable menu stills for cover.jpg');
    callback();
    return;
  }

  console.log(
    'Cover source:',
    source.name,
    '(' + source.size + ' bytes)',
    '—',
    source.reason,
  );

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
