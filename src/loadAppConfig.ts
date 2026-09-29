import fs from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJsonFile } from './server/utils/loadJson.js';

export type AppConfig = {
  webFolder: string;
  staticServerPort: number;
  /**
   * When true, the HTTP server deletes decompressed disc folders after 1h idle
   * (archive kept). Default false — decompress on demand, but keep the cache
   * (typical for local/dev). Enable for production storage savings.
   */
  evictDiscCache?: boolean;
  /**
   * Advertise the HTTP server on the LAN via mDNS. Default true for local
   * play; disable in Docker / remote hosts (`DVDJS_MDNS=0`).
   */
  mdns?: boolean;
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Defaults when no `config/app.json` is present (Docker sets env / mounts JSON). */
export const APP_CONFIG_DEFAULTS: AppConfig = {
  webFolder: join(ROOT, 'web'),
  staticServerPort: 3000,
  evictDiscCache: false,
  mdns: true,
};

function envBool(name: string): boolean | undefined {
  var raw = process.env[name];
  if (raw === undefined || raw === '') {
    return undefined;
  }
  return /^(1|true|yes|on)$/i.test(raw);
}

function envInt(name: string): number | undefined {
  var raw = process.env[name];
  if (raw === undefined || raw === '') {
    return undefined;
  }
  var n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Resolve JSON config path: `DVDJS_CONFIG` (absolute or cwd-relative), else
 * repo `config/app.json` when it exists.
 */
export function resolveAppConfigPath(): string | null {
  var fromEnv = process.env.DVDJS_CONFIG;
  if (fromEnv) {
    return isAbsolute(fromEnv) ? fromEnv : join(process.cwd(), fromEnv);
  }
  var defaultPath = join(ROOT, 'config', 'app.json');
  return fs.existsSync(defaultPath) ? defaultPath : null;
}

/**
 * Load app config. Precedence: environment → JSON file → defaults.
 *
 * Env keys: `DVDJS_CONFIG`, `DVDJS_WEB_FOLDER`, `DVDJS_PORT` (or
 * `DVDJS_STATIC_SERVER_PORT`), `DVDJS_EVICT_DISC_CACHE`, `DVDJS_MDNS`.
 */
export function loadAppConfig(): AppConfig {
  var configPath = resolveAppConfigPath();
  var fileCfg: Partial<AppConfig> = {};
  if (configPath) {
    if (!fs.existsSync(configPath)) {
      throw new Error('DVDJS_CONFIG points to a missing file: ' + configPath);
    }
    fileCfg = loadJsonFile<Partial<AppConfig>>(configPath);
  }

  var webFolder =
    process.env.DVDJS_WEB_FOLDER ||
    fileCfg.webFolder ||
    APP_CONFIG_DEFAULTS.webFolder;

  var staticServerPort =
    envInt('DVDJS_PORT') ??
    envInt('DVDJS_STATIC_SERVER_PORT') ??
    fileCfg.staticServerPort ??
    APP_CONFIG_DEFAULTS.staticServerPort;

  var evictDiscCache =
    envBool('DVDJS_EVICT_DISC_CACHE') ??
    fileCfg.evictDiscCache ??
    APP_CONFIG_DEFAULTS.evictDiscCache;

  var mdns =
    envBool('DVDJS_MDNS') ?? fileCfg.mdns ?? APP_CONFIG_DEFAULTS.mdns;

  return {
    webFolder: webFolder,
    staticServerPort: staticServerPort,
    evictDiscCache: evictDiscCache,
    mdns: mdns,
  };
}

const appConfig = loadAppConfig();
export default appConfig;
