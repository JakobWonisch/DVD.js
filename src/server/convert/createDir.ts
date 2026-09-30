// Create the directory containing the static assets.

'use strict';


import * as fs from 'node:fs';
import * as path from 'node:path';

import { beginDiscConvert, migrateLegacyDiscDir } from '../discCache.js';
import * as serverUtils from '../../server/utils/index.js';

export default createDir;

/**
 * Create a subfolder to `webFolder` named like the DVD disc.
 *
 * @param {string} dvdPath
 * @param {function} callback
 */
function createDir(dvdPath, callback) {
  process.stdout.write('\nCreating the `web` folder:\n');

  var webPath = serverUtils.getWebPath(dvdPath);
  var webFolder = path.dirname(webPath);
  var discId = path.basename(webPath);
  try {
    migrateLegacyDiscDir(webFolder, dvdPath);
  } catch (err) {
    console.error(err);
  }

  fs.mkdir(webPath, function (err) {
    if (err && err.code === 'EEXIST') {
      process.stdout.write('(Folder already exists)\n');
    } else if (err) {
      console.error(err);
    }

    try {
      beginDiscConvert(webFolder, discId);
    } catch (markErr) {
      console.error(markErr);
    }

    process.stdout.write('.');

    callback();
  });
}
