import fs from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJsonFile } from './server/utils/loadJson.js';
import { ENV_PREFIX, envName, envRaw } from './projectId.js';

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
   * Directory for viewer “Report a problem” session logs.
   * Default: `<webFolder>/.dvd-menu-archive-reports`.
   */
  reportsFolder?: string;
  /** Max stored report files (default 100). */
  reportsMaxCount?: number;
  /** Max total bytes of all reports (default 50MB). */
  reportsMaxTotalBytes?: number;
  /** Max single report body (default 512KB). */
  reportsMaxBodyBytes?: number;
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Defaults when no `config/app.json` is present (Docker sets env / mounts JSON). */
export const APP_CONFIG_DEFAULTS: AppConfig = {
  webFolder: join(ROOT, 'web'),
  staticServerPort: 3000,
  evictDiscCache: false,
  reportsFolder: join(ROOT, 'web', '.dvd-menu-archive-reports'),
  reportsMaxCount: 100,
  reportsMaxTotalBytes: 50 * 1024 * 1024,
  reportsMaxBodyBytes: 512 * 1024,
};

function envBool(suffix: string): boolean | undefined {
  var raw = envRaw(suffix);
  if (raw === undefined || raw === '') {
    return undefined;
  }
  return /^(1|true|yes|on)$/i.test(raw);
}

function envInt(suffix: string): number | undefined {
  var raw = envRaw(suffix);
  if (raw === undefined || raw === '') {
    return undefined;
  }
  var n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Resolve JSON config path: `DVD_MENU_ARCHIVE_CONFIG` (or legacy `DVDJS_CONFIG`),
 * else repo `config/app.json` when it exists.
 */
export function resolveAppConfigPath(): string | null {
  var fromEnv = envRaw('CONFIG');
  if (fromEnv) {
    return isAbsolute(fromEnv) ? fromEnv : join(process.cwd(), fromEnv);
  }
  var defaultPath = join(ROOT, 'config', 'app.json');
  return fs.existsSync(defaultPath) ? defaultPath : null;
}

/**
 * Load app config. Precedence: environment → JSON file → defaults.
 *
 * Env keys (prefer `DVD_MENU_ARCHIVE_*`; `DVDJS_*` still accepted):
 * `CONFIG`, `WEB_FOLDER`, `PORT` (or `STATIC_SERVER_PORT`),
 * `EVICT_DISC_CACHE`, `REPORTS_FOLDER`, `REPORTS_MAX_COUNT`,
 * `REPORTS_MAX_TOTAL_BYTES`, `REPORTS_MAX_BODY_BYTES`.
 */
export function loadAppConfig(): AppConfig {
  var configPath = resolveAppConfigPath();
  var fileCfg: Partial<AppConfig> = {};
  if (configPath) {
    if (!fs.existsSync(configPath)) {
      throw new Error(
        envName('CONFIG') + ' points to a missing file: ' + configPath,
      );
    }
    fileCfg = loadJsonFile<Partial<AppConfig>>(configPath);
  }

  var webFolder =
    envRaw('WEB_FOLDER') ||
    fileCfg.webFolder ||
    APP_CONFIG_DEFAULTS.webFolder;

  var staticServerPort =
    envInt('PORT') ??
    envInt('STATIC_SERVER_PORT') ??
    fileCfg.staticServerPort ??
    APP_CONFIG_DEFAULTS.staticServerPort;

  var evictDiscCache =
    envBool('EVICT_DISC_CACHE') ??
    fileCfg.evictDiscCache ??
    APP_CONFIG_DEFAULTS.evictDiscCache;


  var reportsFolderRaw =
    envRaw('REPORTS_FOLDER') || fileCfg.reportsFolder || null;
  var reportsFolder = reportsFolderRaw
    ? isAbsolute(reportsFolderRaw)
      ? reportsFolderRaw
      : join(process.cwd(), reportsFolderRaw)
    : join(webFolder, '.dvd-menu-archive-reports');

  var reportsMaxCount =
    envInt('REPORTS_MAX_COUNT') ??
    fileCfg.reportsMaxCount ??
    APP_CONFIG_DEFAULTS.reportsMaxCount;

  var reportsMaxTotalBytes =
    envInt('REPORTS_MAX_TOTAL_BYTES') ??
    fileCfg.reportsMaxTotalBytes ??
    APP_CONFIG_DEFAULTS.reportsMaxTotalBytes;

  var reportsMaxBodyBytes =
    envInt('REPORTS_MAX_BODY_BYTES') ??
    fileCfg.reportsMaxBodyBytes ??
    APP_CONFIG_DEFAULTS.reportsMaxBodyBytes;

  return {
    webFolder: webFolder,
    staticServerPort: staticServerPort,
    evictDiscCache: evictDiscCache,
    reportsFolder: reportsFolder,
    reportsMaxCount: reportsMaxCount,
    reportsMaxTotalBytes: reportsMaxTotalBytes,
    reportsMaxBodyBytes: reportsMaxBodyBytes,
  };
}

const appConfig = loadAppConfig();
export default appConfig;

// Re-export so callers/docs can mention the prefix without hard-coding.
export { ENV_PREFIX };
