/**
 * Load convert `titlePgcMedia` from metadata.json beside a vm.js path.
 * Used by explore + smoke compares for menus-only omitted-title soft-pass.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export type TitlePgcMedia = {
  includedPgcs?: number[];
  stubs?: Record<string, { kind?: string }>;
};

export function loadTitlePgcMedia(
  vmJsPath: string,
): Map<number, TitlePgcMedia> {
  const out = new Map<number, TitlePgcMedia>();
  const metaPath = path.join(path.dirname(vmJsPath), 'metadata.json');
  if (!fs.existsSync(metaPath)) return out;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<
      string,
      { titlePgcMedia?: TitlePgcMedia }
    >;
    for (const [key, val] of Object.entries(meta)) {
      const d = Number(key);
      if (!Number.isFinite(d) || !val?.titlePgcMedia) continue;
      out.set(d, val.titlePgcMedia);
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** True when menus-only convert omitted this title PGC (skip/interactive stub). */
export function isOmittedTitle(
  titleMedia: Map<number, TitlePgcMedia>,
  vts: number,
  pgc: number,
): boolean {
  const media = titleMedia.get(vts);
  if (!media) return false;
  const stub = media.stubs?.[String(pgc)];
  if (stub?.kind === 'skip' || stub?.kind === 'interactive') return true;
  const included = media.includedPgcs;
  if (Array.isArray(included) && included.length > 0) {
    return !included.includes(pgc);
  }
  if (Array.isArray(included) && included.length === 0 && media.stubs) {
    return true;
  }
  return false;
}
