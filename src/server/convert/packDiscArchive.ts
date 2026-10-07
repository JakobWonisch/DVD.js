// Pack a converted disc folder into a compressed archive at rest.

'use strict';

import * as path from 'node:path';

import appConfig from '../../loadAppConfig.js';
import { endDiscConvert, migrateLegacyDiscDir, packDiscArchive } from '../discCache.js';
import * as serverUtils from '../utils/index.js';

export default packConvertedDisc;

/**
 * After convert, write webFolder/<disc>.tar.gz (+ cover sidecar).
 * When `evictDiscCache` is false (local/dev default), keep the unpacked folder
 * so IFO/NAV JSON remain for `--vm-only`. When true, delete the folder (archive
 * only at rest).
 */
function packConvertedDisc(dvdPath: string, callback: () => void): void {
  var webPath = serverUtils.getWebPath(dvdPath);
  var discId = path.basename(webPath);
  var webFolder = path.dirname(webPath);
  // Mirror HTTP eviction: keep unpack for local/dev; strip after pack in prod.
  var keepUnpacked = !appConfig.evictDiscCache;

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

  packDiscArchive(webFolder, discId, { keepUnpacked: keepUnpacked })
    .then(function () {
      process.stdout.write('  ' + discId + '.tar.gz\n');
      if (keepUnpacked) {
        process.stdout.write(
          '  kept unpacked folder (evictDiscCache=false; --vm-only OK)\n',
        );
      }
      callback();
    })
    .catch(function (err) {
      console.error(err);
      // Leave the unpacked folder so the convert is still usable.
      endDiscConvert(webFolder, discId);
      callback();
    });
}
