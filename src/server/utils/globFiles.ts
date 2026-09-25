import { glob } from 'node:fs/promises';

/**
 * Collect paths matching a glob pattern via Node's built-in `fs.glob`.
 * Callback shape matches the old `glob` package used by the convert pipeline.
 */
export function globFiles(
  pattern: string,
  callback: (err: Error | null, files: string[]) => void,
): void {
  (async () => {
    const files: string[] = [];
    for await (const entry of glob(pattern)) {
      files.push(String(entry));
    }
    return files;
  })().then(
    (files) => callback(null, files),
    (err: Error) => callback(err, []),
  );
}
