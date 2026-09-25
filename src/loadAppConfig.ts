import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJsonFile } from './server/utils/loadJson.js';

export type AppConfig = {
  webFolder: string;
  staticServerPort: number;
};

const configPath = join(dirname(fileURLToPath(import.meta.url)), '../config/app.json');

/** Load repo `config/app.json` (copy from `config/app.example.json` if missing). */
export function loadAppConfig(): AppConfig {
  return loadJsonFile<AppConfig>(configPath);
}

const appConfig = loadAppConfig();
export default appConfig;
