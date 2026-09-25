import fs from 'node:fs';

/** Read and parse a JSON file from an absolute or relative path (ESM replacement for require(jsonPath)). */
export function loadJsonFile<T = any>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}
