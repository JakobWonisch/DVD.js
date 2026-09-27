// Return the list of DVD available locally (archives and/or unpacked folders).

'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';

import * as utils from '../../utils.js';
import {
  coverSidecarPath,
  hasArchive,
  isDiscReady,
  isSafeDiscId,
} from '../discCache.js';

export default getDVDList;

export type DvdListEntry = {
  name: string;
  dir: string;
  /** Path relative to webFolder for the catalogue thumbnail. */
  cover: string;
};

/**
 * Return the list of discs under webFolder.
 * Includes .tar.gz archives and unpacked directories that have metadata.json.
 *
 * @param {string} dvdPath
 * @param {function(Array.<DvdListEntry>)} callback
 */
function getDVDList(
  dvdPath: string,
  callback: (dvds: DvdListEntry[]) => void,
): void {
  var seen = new Set<string>();
  var dvds: DvdListEntry[] = [];

  if (!fs.existsSync(dvdPath)) {
    callback(dvds);
    return;
  }

  var entries = fs.readdirSync(dvdPath);
  for (var i = 0; i < entries.length; i++) {
    var file = entries[i];
    var discId: string | null = null;

    if (file.endsWith('.tar.gz')) {
      discId = file.slice(0, -'.tar.gz'.length);
    } else {
      var filePath = path.join(dvdPath, file);
      var stats: fs.Stats;
      try {
        stats = fs.statSync(filePath);
      } catch {
        continue;
      }
      if (stats.isDirectory() && isDiscReady(dvdPath, file)) {
        discId = file;
      }
    }

    if (!discId || !isSafeDiscId(discId) || seen.has(discId)) {
      continue;
    }
    // Skip empty/orphan names.
    if (!hasArchive(dvdPath, discId) && !isDiscReady(dvdPath, discId)) {
      continue;
    }

    seen.add(discId);
    var coverSidecar = coverSidecarPath(dvdPath, discId);
    var cover = fs.existsSync(coverSidecar)
      ? path.basename(coverSidecar)
      : discId + '/cover.jpg';

    dvds.push({
      name: utils.formatTitle(discId),
      dir: discId,
      cover: cover,
    });
  }

  callback(dvds);
}
