import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  APP_CONFIG_DEFAULTS,
  loadAppConfig,
} from '../../src/loadAppConfig.js';

const ENV_KEYS = [
  'DVD_MENU_ARCHIVE_CONFIG',
  'DVD_MENU_ARCHIVE_WEB_FOLDER',
  'DVD_MENU_ARCHIVE_PORT',
  'DVD_MENU_ARCHIVE_STATIC_SERVER_PORT',
  'DVD_MENU_ARCHIVE_EVICT_DISC_CACHE',
  'DVDJS_CONFIG',
  'DVDJS_WEB_FOLDER',
  'DVDJS_PORT',
  'DVDJS_STATIC_SERVER_PORT',
  'DVDJS_EVICT_DISC_CACHE',
] as const;

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {};

afterEach(function () {
  for (var i = 0; i < ENV_KEYS.length; i++) {
    var key = ENV_KEYS[i];
    if (Object.prototype.hasOwnProperty.call(saved, key)) {
      var prev = saved[key];
      if (prev === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev;
      }
      delete saved[key];
    }
  }
});

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined) {
  if (!Object.prototype.hasOwnProperty.call(saved, key)) {
    saved[key] = process.env[key];
  }
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function clearAllEnv() {
  for (var i = 0; i < ENV_KEYS.length; i++) {
    setEnv(ENV_KEYS[i], undefined);
  }
}

function writeTempConfig(body: object): string {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvd-menu-archive-cfg-'));
  var file = path.join(dir, 'app.json');
  fs.writeFileSync(file, JSON.stringify(body));
  return file;
}

describe('loadAppConfig', function () {
  it('loads values from DVD_MENU_ARCHIVE_CONFIG JSON', function () {
    clearAllEnv();
    var file = writeTempConfig({
      webFolder: '/from/json',
      staticServerPort: 4000,
      evictDiscCache: true,
    });
    setEnv('DVD_MENU_ARCHIVE_CONFIG', file);

    expect(loadAppConfig()).toMatchObject({
      webFolder: '/from/json',
      staticServerPort: 4000,
      evictDiscCache: true,
      reportsFolder: '/from/json/.dvd-menu-archive-reports',
    });
  });

  it('lets environment override JSON', function () {
    clearAllEnv();
    var file = writeTempConfig({
      webFolder: '/from/json',
      staticServerPort: 4000,
      evictDiscCache: false,
    });
    setEnv('DVD_MENU_ARCHIVE_CONFIG', file);
    setEnv('DVD_MENU_ARCHIVE_WEB_FOLDER', '/from/env');
    setEnv('DVD_MENU_ARCHIVE_PORT', '8080');
    setEnv('DVD_MENU_ARCHIVE_EVICT_DISC_CACHE', 'true');

    expect(loadAppConfig()).toMatchObject({
      webFolder: '/from/env',
      staticServerPort: 8080,
      evictDiscCache: true,
      reportsFolder: '/from/env/.dvd-menu-archive-reports',
    });
  });

  it('uses defaults when no file and no env', function () {
    clearAllEnv();
    var missing = path.join(
      os.tmpdir(),
      'dvd-menu-archive-missing-config-' + process.pid + '.json',
    );
    setEnv('DVD_MENU_ARCHIVE_CONFIG', missing);
    expect(function () {
      loadAppConfig();
    }).toThrow(/missing file/);

    setEnv('DVD_MENU_ARCHIVE_CONFIG', writeTempConfig({}));

    expect(loadAppConfig()).toEqual(APP_CONFIG_DEFAULTS);
  });

  it('accepts DVD_MENU_ARCHIVE_STATIC_SERVER_PORT as port alias', function () {
    clearAllEnv();
    setEnv('DVD_MENU_ARCHIVE_CONFIG', writeTempConfig({}));
    setEnv('DVD_MENU_ARCHIVE_STATIC_SERVER_PORT', '9090');

    expect(loadAppConfig().staticServerPort).toBe(9090);
  });

  it('still accepts legacy DVDJS_* env keys', function () {
    clearAllEnv();
    setEnv('DVDJS_CONFIG', writeTempConfig({}));
    setEnv('DVDJS_WEB_FOLDER', '/legacy/web');
    setEnv('DVDJS_PORT', '7070');

    expect(loadAppConfig()).toMatchObject({
      webFolder: '/legacy/web',
      staticServerPort: 7070,
    });
  });

  it('prefers DVD_MENU_ARCHIVE_* over legacy DVDJS_*', function () {
    clearAllEnv();
    setEnv('DVD_MENU_ARCHIVE_CONFIG', writeTempConfig({}));
    setEnv('DVD_MENU_ARCHIVE_WEB_FOLDER', '/modern');
    setEnv('DVDJS_WEB_FOLDER', '/legacy');

    expect(loadAppConfig().webFolder).toBe('/modern');
  });
});
