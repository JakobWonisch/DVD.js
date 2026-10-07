/**
 * Choose catalogue cover.jpg source: prefer the menu cell that starts the
 * longest title (Play button), then VMGM Title → Root → other Title, then
 * the largest usable VMGM still.
 */

'use strict';

/**
 * Ignore gray placeholder / tiny failed stills (~0.8–3KB) when choosing a
 * cover. Real dark WebP main menus (Harry Potter) often sit at 15–30KB — the
 * old 32KB floor rejected them and fell through to a large copyright still.
 */
export const MIN_COVER_STILL_BYTES = 4 * 1024;

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

/** Cell that can start the main (longest) title — from findPlayTitleCoverCells. */
export type CoverPlayTitleCell = {
  domain: number;
  cellID: number;
  vobID: number;
  reason?: string;
  via?: string;
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

/** Per-cell cover ranking hints derived from metadata menu LUs. */
export type CoverCellLangRank = {
  /** Lower is better — index in orderMenuLangs (en=0, default=1, …). */
  langRank: number;
  /** Best matching LU code (for reason strings). */
  lang: string;
  /** Index of the first PGC in that LU that contains the cell (earlier = better). */
  pgcOrd: number;
  /** True when the cell sits on a Title/Root entry PGC. */
  mainMenu: boolean;
};

/**
 * Map domain:cell:vob → language / PGC-order ranks for cover preference.
 * Within one LU (Avatar-style multi-language cells), earlier PGCs are usually
 * the primary (often English) menus.
 */
export function coverCellLangRanks(
  metadata: CoverDomainMeta[] | null | undefined,
): Map<string, CoverCellLangRank> {
  const out = new Map<string, CoverCellLangRank>();
  if (!Array.isArray(metadata)) {
    return out;
  }

  for (let domain = 0; domain < metadata.length; domain++) {
    const byLang = metadata[domain] && metadata[domain].menu;
    if (!byLang) {
      continue;
    }
    const langs = orderMenuLangs(Object.keys(byLang));
    for (let li = 0; li < langs.length; li++) {
      const lang = langs[li];
      const pgcs = byLang[lang];
      if (!Array.isArray(pgcs)) {
        continue;
      }
      for (let pi = 0; pi < pgcs.length; pi++) {
        const pgc = pgcs[pi];
        if (!pgc || !Array.isArray(pgc.cells)) {
          continue;
        }
        const main = menuType(pgc.entry) === MENU_TYPE_TITLE ||
          menuType(pgc.entry) === MENU_TYPE_ROOT;
        for (let ci = 0; ci < pgc.cells.length; ci++) {
          const cell = pgc.cells[ci];
          if (!cell || cell.cellID == null || cell.vobID == null) {
            continue;
          }
          const key = stillKey(domain, cell.cellID, cell.vobID);
          const prev = out.get(key);
          const cand: CoverCellLangRank = {
            langRank: li,
            lang: lang,
            pgcOrd: pi,
            mainMenu: main,
          };
          if (
            !prev ||
            cand.langRank < prev.langRank ||
            (cand.langRank === prev.langRank && cand.pgcOrd < prev.pgcOrd) ||
            (cand.langRank === prev.langRank &&
              cand.pgcOrd === prev.pgcOrd &&
              cand.mainMenu &&
              !prev.mainMenu)
          ) {
            // Keep mainMenu if any matching PGC is Title/Root.
            if (prev && prev.mainMenu) {
              cand.mainMenu = true;
            }
            out.set(key, cand);
          } else if (prev && main) {
            prev.mainMenu = true;
          }
        }
      }
    }
  }
  return out;
}

/**
 * Order play-title cells for cover: Title/Root → en/default → earlier PGC
 * in that LU → original discovery order.
 */
export function sortPlayTitleCellsForCover(
  playCells: CoverPlayTitleCell[],
  metadata?: CoverDomainMeta[] | null,
): CoverPlayTitleCell[] {
  if (!playCells.length) {
    return playCells;
  }
  const ranks = coverCellLangRanks(metadata);
  const indexed = playCells.map(function (play, index) {
    return { play: play, index: index };
  });
  indexed.sort(function (a, b) {
    const ka = stillKey(a.play.domain, a.play.cellID, a.play.vobID);
    const kb = stillKey(b.play.domain, b.play.cellID, b.play.vobID);
    const ra = ranks.get(ka);
    const rb = ranks.get(kb);
    const mainA = ra && ra.mainMenu ? 0 : 1;
    const mainB = rb && rb.mainMenu ? 0 : 1;
    if (mainA !== mainB) {
      return mainA - mainB;
    }
    const langA = ra ? ra.langRank : 999;
    const langB = rb ? rb.langRank : 999;
    if (langA !== langB) {
      return langA - langB;
    }
    const pgcA = ra ? ra.pgcOrd : 9999;
    const pgcB = rb ? rb.pgcOrd : 9999;
    if (pgcA !== pgcB) {
      return pgcA - pgcB;
    }
    return a.index - b.index;
  });
  return indexed.map(function (x) {
    return x.play;
  });
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
 * Keys of cells that belong to any Title/Root menu PGC in metadata.
 */
export function mainMenuStillKeys(
  metadata: CoverDomainMeta[] | null | undefined,
): Set<string> {
  const keys = new Set<string>();
  for (const cand of listMainMenuCandidates(metadata)) {
    const cells = cand.pgc.cells || [];
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (!cell || cell.cellID == null || cell.vobID == null) {
        continue;
      }
      keys.add(stillKey(cand.domain, cell.cellID, cell.vobID));
    }
  }
  return keys;
}

function stillFromPlayCell(
  play: CoverPlayTitleCell,
  byKey: Map<string, CoverStillFile>,
): CoverStillPick | null {
  const still = byKey.get(stillKey(play.domain, play.cellID, play.vobID));
  if (!still) {
    return null;
  }
  return {
    ...still,
    reason: play.reason || 'play-title menu cell',
  };
}

/**
 * Prefer play-title cells on Title/Root, then en/default (earlier PGC within
 * that LU), then other play trampolines, then classic Title/Root stills.
 */
export function pickCoverStill(opts: {
  stills: CoverStillFile[];
  metadata?: CoverDomainMeta[] | null;
  playTitleCells?: CoverPlayTitleCell[] | null;
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

  const ranks = coverCellLangRanks(opts.metadata);
  const playCells = sortPlayTitleCellsForCover(
    opts.playTitleCells || [],
    opts.metadata,
  );
  if (playCells.length) {
    for (let i = 0; i < playCells.length; i++) {
      const play = playCells[i];
      const hit = stillFromPlayCell(play, byKey);
      if (!hit) {
        continue;
      }
      const rank = ranks.get(
        stillKey(play.domain, play.cellID, play.vobID),
      );
      if (rank && rank.lang) {
        hit.reason =
          (play.reason || hit.reason) + ' (lang ' + rank.lang + ')';
      }
      return hit;
    }
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

/** Parse menu-D-C-V.webp|png into a CoverStillFile (size filled by caller). */
export function parseMenuStillName(
  name: string,
  full: string,
  size: number,
): CoverStillFile | null {
  const m = name.match(/^menu-(\d+)-(\d+)-(\d+)\.(?:webp|png)$/i);
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
