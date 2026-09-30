/**
 * Choose catalogue cover.jpg source: prefer the main-menu still
 * (VMGM Title → Root → other Title), not the largest/first VMGM frame.
 */

'use strict';

/** Ignore tiny/gray failed stills when choosing a cover. */
export const MIN_COVER_STILL_BYTES = 32 * 1024;

/** DVD PGCI menu type nibble (entry_id & 0x0f). */
export const MENU_TYPE_TITLE = 2;
export const MENU_TYPE_ROOT = 3;

export type CoverStillFile = {
  name: string;
  full: string;
  size: number;
  domain: number;
  cellID: number;
  vobID: number;
};

export type CoverMenuCell = {
  cellID?: number | null;
  vobID?: number | null;
  still_time?: number | null;
};

export type CoverMenuPgc = {
  pgc?: number;
  /** Full PGCI entry_id; menu type is entry & 0x0f. */
  entry?: number | null;
  cells?: CoverMenuCell[] | null;
};

export type CoverDomainMeta = {
  menu?: Record<string, CoverMenuPgc[] | undefined> | null;
};

export type CoverStillPick = CoverStillFile & {
  reason: string;
};

function menuType(entry: number | null | undefined): number {
  if (entry == null || !Number.isFinite(entry)) {
    return 0;
  }
  return entry & 0x0f;
}

function stillKey(domain: number, cellID: number, vobID: number): string {
  return domain + ':' + cellID + ':' + vobID;
}

/** Lang preference: en → default → remaining keys in stable order. */
export function orderMenuLangs(langs: string[]): string[] {
  const unique = Array.from(new Set(langs.filter(Boolean)));
  const prefer = ['en', 'default'];
  const out: string[] = [];
  for (const p of prefer) {
    if (unique.includes(p)) {
      out.push(p);
    }
  }
  for (const lang of unique) {
    if (!out.includes(lang)) {
      out.push(lang);
    }
  }
  return out;
}

/**
 * Score a cell still within a main-menu PGC.
 * Prefer infinite stills, then timed stills, then later cells (intro → menu),
 * then larger files as a weak quality proxy.
 */
export function scoreMainMenuCellStill(
  still: CoverStillFile,
  cell: CoverMenuCell,
  cellIndex: number,
): number {
  const stillTime = cell.still_time != null ? cell.still_time : 0;
  let score = still.size;
  if (stillTime === 255) {
    score += 1e12;
  } else if (stillTime > 0) {
    score += 1e9 + stillTime * 1e6;
  }
  score += cellIndex * 1e5;
  return score;
}

type MenuCandidate = {
  domain: number;
  lang: string;
  pgc: CoverMenuPgc;
  menuKind: 'title' | 'root';
  /** Lower is better — matches goToMainMenu preference. */
  priority: number;
};

/**
 * Enumerate Title/Root menu PGCs in the same preference order as the viewer
 * main-menu escape (VMGM Title → Root → other Title).
 */
export function listMainMenuCandidates(
  metadata: CoverDomainMeta[] | null | undefined,
): MenuCandidate[] {
  if (!Array.isArray(metadata)) {
    return [];
  }

  const out: MenuCandidate[] = [];

  function pushDomain(
    domain: number,
    wantType: number,
    menuKind: 'title' | 'root',
    priority: number,
  ) {
    const domainMeta = metadata[domain];
    const byLang = domainMeta && domainMeta.menu;
    if (!byLang) {
      return;
    }
    for (const lang of orderMenuLangs(Object.keys(byLang))) {
      const pgcs = byLang[lang];
      if (!Array.isArray(pgcs)) {
        continue;
      }
      for (const pgc of pgcs) {
        if (!pgc || menuType(pgc.entry) !== wantType) {
          continue;
        }
        if (!Array.isArray(pgc.cells) || !pgc.cells.length) {
          continue;
        }
        out.push({ domain, lang, pgc, menuKind, priority });
      }
    }
  }

  // 1. VMGM Title
  pushDomain(0, MENU_TYPE_TITLE, 'title', 0);

  // 2. Root in any domain (HP menus live in VTS Root only)
  for (let d = 0; d < metadata.length; d++) {
    pushDomain(d, MENU_TYPE_ROOT, 'root', 1);
  }

  // 3. Title menus outside VMGM
  for (let d = 1; d < metadata.length; d++) {
    pushDomain(d, MENU_TYPE_TITLE, 'title', 2);
  }

  out.sort(function (a, b) {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    if (a.domain !== b.domain) {
      return a.domain - b.domain;
    }
    return 0;
  });

  return out;
}

function bestStillForPgc(
  domain: number,
  pgc: CoverMenuPgc,
  byKey: Map<string, CoverStillFile>,
): CoverStillFile | null {
  const cells = pgc.cells || [];
  let best: CoverStillFile | null = null;
  let bestScore = -1;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!cell || cell.cellID == null || cell.vobID == null) {
      continue;
    }
    const still = byKey.get(stillKey(domain, cell.cellID, cell.vobID));
    if (!still) {
      continue;
    }
    const score = scoreMainMenuCellStill(still, cell, i);
    if (score > bestScore) {
      bestScore = score;
      best = still;
    }
  }

  return best;
}

/**
 * Legacy fallback: prefer VMGM (domain 0), then largest usable still.
 */
export function pickLargestDomainStill(
  stills: CoverStillFile[],
): CoverStillFile | null {
  if (!stills.length) {
    return null;
  }
  const sorted = stills.slice().sort(function (a, b) {
    if (a.domain !== b.domain) {
      return a.domain - b.domain;
    }
    return b.size - a.size;
  });
  return sorted[0] || null;
}

/**
 * Pick the best cover still from converted menu PNGs + metadata.
 */
export function pickCoverStill(opts: {
  stills: CoverStillFile[];
  metadata?: CoverDomainMeta[] | null;
}): CoverStillPick | null {
  const usable = (opts.stills || []).filter(function (s) {
    return s && s.size >= MIN_COVER_STILL_BYTES;
  });
  if (!usable.length) {
    return null;
  }

  const byKey = new Map<string, CoverStillFile>();
  for (const still of usable) {
    byKey.set(stillKey(still.domain, still.cellID, still.vobID), still);
  }

  for (const cand of listMainMenuCandidates(opts.metadata)) {
    const still = bestStillForPgc(cand.domain, cand.pgc, byKey);
    if (still) {
      return {
        ...still,
        reason:
          cand.menuKind +
          ' menu domain ' +
          cand.domain +
          ' lang ' +
          cand.lang +
          ' pgc ' +
          (cand.pgc.pgc != null ? cand.pgc.pgc : '?'),
      };
    }
  }

  const fallback = pickLargestDomainStill(usable);
  if (!fallback) {
    return null;
  }
  return {
    ...fallback,
    reason: 'largest usable still (no main-menu match)',
  };
}

/** Parse menu-D-C-V.png into a CoverStillFile (size filled by caller). */
export function parseMenuStillName(
  name: string,
  full: string,
  size: number,
): CoverStillFile | null {
  const m = name.match(/^menu-(\d+)-(\d+)-(\d+)\.png$/i);
  if (!m) {
    return null;
  }
  return {
    name: name,
    full: full,
    size: size,
    domain: parseInt(m[1], 10),
    cellID: parseInt(m[2], 10),
    vobID: parseInt(m[3], 10),
  };
}
