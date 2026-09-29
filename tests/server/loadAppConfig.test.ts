import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  APP_CONFIG_DEFAULTS,
  loadAppConfig,
} from '../../src/loadAppConfig.js';

const ENV_KEYS = [
  'DVDJS_CONFIG',
  'DVDJS_WEB_FOLDER',
  'DVDJS_PORT',
  'DVDJS_STATIC_SERVER_PORT',
  'DVDJS_EVICT_DISC_CACHE',
  'DVDJS_MDNS',
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

function writeTempConfig(body: object): string {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvdjs-cfg-'));
  var file = path.join(dir, 'app.json');
  fs.writeFileSync(file, JSON.stringify(body));
  return file;
}

describe('loadAppConfig', function () {
  it('loads values from DVDJS_CONFIG JSON', function () {
    var file = writeTempConfig({
      webFolder: '/from/json',
      staticServerPort: 4000,
      evictDiscCache: true,
      mdns: false,
    });
    setEnv('DVDJS_CONFIG', file);
    setEnv('DVDJS_WEB_FOLDER', undefined);
    setEnv('DVDJS_PORT', undefined);
    setEnv('DVDJS_STATIC_SERVER_PORT', undefined);
    setEnv('DVDJS_EVICT_DISC_CACHE', undefined);
    setEnv('DVDJS_MDNS', undefined);

    expect(loadAppConfig()).toEqual({
      webFolder: '/from/json',
      staticServerPort: 4000,
      evictDiscCache: true,
      mdns: false,
    });
  });

  it('lets environment override JSON', function () {
    var file = writeTempConfig({
      webFolder: '/from/json',
      staticServerPort: 4000,
      evictDiscCache: false,
      mdns: true,
    });
    setEnv('DVDJS_CONFIG', file);
    setEnv('DVDJS_WEB_FOLDER', '/from/env');
    setEnv('DVDJS_PORT', '8080');
    setEnv('DVDJS_EVICT_DISC_CACHE', 'true');
    setEnv('DVDJS_MDNS', '0');

    expect(loadAppConfig()).toEqual({
      webFolder: '/from/env',
      staticServerPort: 8080,
      evictDiscCache: true,
      mdns: false,
    });
  });

  it('uses defaults when no file and no env', function () {
    var missing = path.join(
      os.tmpdir(),
      'dvdjs-missing-config-' + process.pid + '.json',
    );
    setEnv('DVDJS_CONFIG', missing);
    expect(function () {
      loadAppConfig();
    }).toThrow(/missing file/);

    setEnv('DVDJS_CONFIG', writeTempConfig({}));
    setEnv('DVDJS_WEB_FOLDER', undefined);
    setEnv('DVDJS_PORT', undefined);
    setEnv('DVDJS_STATIC_SERVER_PORT', undefined);
    setEnv('DVDJS_EVICT_DISC_CACHE', undefined);
    setEnv('DVDJS_MDNS', undefined);

    expect(loadAppConfig()).toEqual(APP_CONFIG_DEFAULTS);
  });

  it('accepts DVDJS_STATIC_SERVER_PORT as port alias', function () {
    setEnv('DVDJS_CONFIG', writeTempConfig({}));
    setEnv('DVDJS_PORT', undefined);
    setEnv('DVDJS_STATIC_SERVER_PORT', '9090');

    expect(loadAppConfig().staticServerPort).toBe(9090);
  });
});
