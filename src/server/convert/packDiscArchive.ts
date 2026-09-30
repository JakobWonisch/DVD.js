// Pack a converted disc folder into a compressed archive at rest.

'use strict';

import * as path from 'node:path';

import { endDiscConvert, migrateLegacyDiscDir, packDiscArchive } from '../discCache.js';
import * as serverUtils from '../utils/index.js';

export default packConvertedDisc;

/**
 * After convert, replace webFolder/<disc>/ with <disc>.tar.gz (+ cover sidecar).
 */
function packConvertedDisc(dvdPath: string, callback: () => void): void {
  var webPath = serverUtils.getWebPath(dvdPath);
  var discId = path.basename(webPath);
  var webFolder = path.dirname(webPath);

  process.stdout.write('\nPacking disc archive:\n');

  try {
    var migrated = migrateLegacyDiscDir(webFolder, dvdPath);
    if (migrated) {
      process.stdout.write('  Migrated legacy folder → "' + migrated + '"\n');
    }
  } catch (err) {
    console.error(err);
    endDiscConvert(webFolder, discId);
    callback();
    return;
  }

  packDiscArchive(webFolder, discId)
    .then(function () {
      process.stdout.write('  ' + discId + '.tar.gz\n');
      callback();
    })
    .catch(function (err) {
      console.error(err);
      // Leave the unpacked folder so the convert is still usable.
      endDiscConvert(webFolder, discId);
      callback();
    });
}
