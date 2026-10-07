/**
 * Repack existing unpacked disc folders into .tar.gz without reconverting.
 */

'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';

import appConfig from '../../loadAppConfig.js';
import {
  beginDiscConvert,
  endDiscConvert,
  isSafeDiscId,
  packDiscArchive,
} from '../discCache.js';
import generateCatalogue from './generateCatalogue.js';

/**
 * List unpacked disc ids under webFolder that have metadata.json.
 */
export function listPackableDiscIds(webFolder: string): string[] {
  var names: string[] = [];
  try {
    names = fs.readdirSync(webFolder);
  } catch {
    return [];
  }
  var out: string[] = [];
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    if (!name || name.startsWith('.')) {
      continue;
    }
    if (!isSafeDiscId(name)) {
      continue;
    }
    var dir = path.join(webFolder, name);
    var st: fs.Stats;
    try {
      st = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) {
      continue;
    }
    if (!fs.existsSync(path.join(dir, 'metadata.json'))) {
      continue;
    }
    out.push(name);
  }
  out.sort(function (a, b) {
    return a.localeCompare(b);
  });
  return out;
}

/**
 * Resolve CLI positionals to disc ids (names under webFolder, or paths to
 * folders that already contain metadata.json).
 */
export function resolvePackDiscIds(
  webFolder: string,
  positionals: string[],
): string[] {
  if (!positionals.length) {
    return listPackableDiscIds(webFolder);
  }
  var out: string[] = [];
  var seen = new Set<string>();
  for (var i = 0; i < positionals.length; i++) {
    var raw = String(positionals[i] || '').replace(/[/\\]+$/, '');
    if (!raw) {
      continue;
    }
    var abs = path.isAbsolute(raw) ? raw : path.resolve(raw);
    var discId: string | null = null;
    if (fs.existsSync(path.join(abs, 'metadata.json'))) {
      discId = path.basename(abs);
    } else {
      var underWeb = path.join(webFolder, path.basename(raw));
      if (fs.existsSync(path.join(underWeb, 'metadata.json'))) {
        discId = path.basename(underWeb);
      }
    }
    if (!discId || !isSafeDiscId(discId)) {
      console.error('Not a packable disc folder: ' + raw);
      process.exit(1);
    }
    if (!seen.has(discId)) {
      seen.add(discId);
      out.push(discId);
    }
  }
  return out;
}

/**
 * Pack each disc folder into <discId>.tar.gz (same rules as end-of-convert pack).
 */
export async function packDiscFolders(
  webFolder: string,
  discIds: string[],
): Promise<void> {
  if (!discIds.length) {
    console.error(
      'No unpacked discs with metadata.json under ' + webFolder,
    );
    process.exit(1);
  }

  var keepUnpacked = !appConfig.evictDiscCache;
  process.stdout.write(
    '\nPack-only (' +
      discIds.length +
      ' disc(s)' +
      (keepUnpacked ? ', keep unpacked' : ', remove unpacked after pack') +
      '):\n',
  );

  for (var i = 0; i < discIds.length; i++) {
    var discId = discIds[i];
    process.stdout.write('\n[' + (i + 1) + '/' + discIds.length + '] ' + discId + '\n');
    beginDiscConvert(webFolder, discId);
    try {
      await packDiscArchive(webFolder, discId, {
        keepUnpacked: keepUnpacked,
      });
      process.stdout.write('  ' + discId + '.tar.gz\n');
      if (keepUnpacked) {
        process.stdout.write('  kept unpacked folder\n');
      }
    } catch (err) {
      endDiscConvert(webFolder, discId);
      console.error(err);
      process.exit(1);
    }
  }

  await new Promise<void>(function (resolve) {
    generateCatalogue(function () {
      resolve();
    });
  });
  console.log("That's all folks!");
}
