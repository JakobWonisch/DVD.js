/** Converted disc catalogue entry (`dvds.json`). */
export type DvdListItem = {
  name: string;
  dir: string;
  /** Thumbnail path relative to webFolder root (e.g. `Foo.cover.jpg`). */
  cover?: string;
};

/** Button adjacency from PCI btnit (1-based neighbor ids). */
export type MenuButtonNav = {
  id?: number;
  up?: number;
  down?: number;
  left?: number;
  right?: number;
  auto_action_mode?: number;
  /**
   * Hitbox geometry CSS decls (`left/top/width/height` %). Applied inline so
   * mouse targets work even when menu-*.css attribute selectors miss.
   */
  css?: string;
};

export type MenuCellMeta = {
  still?: string;
  css?: string;
  btn_nb?: number;
  buttons?: MenuButtonNav[];
  hli_s_ptm?: number;
  hli_e_ptm?: number;
  start_sector?: number;
  end_sector?: number;
  startSec?: number;
  endSec?: number;
  /** Base SPU overlay PNG (from extractSpu). */
  spu?: string;
  /** Per-button select-state SPU PNGs. */
  spuSelect?: string[];
  /** Per-button activate-state SPU PNGs. */
  spuActivate?: string[];
  spuFrameHeight?: number;
};

export type MenuCellMap = Record<string, Record<string, MenuCellMeta>>;

export type MenuPgcEntry = {
  pgc: number;
  /** Full PGCI entry_id; menu type is entry & 0x0f (2=Title, 3=Root). */
  entry?: number;
  cellID?: number;
  vobID?: number;
  still_time?: number;
  cells?: unknown[];
};

export type DomainMetadata = {
  menu?: Record<string, MenuPgcEntry[]>;
  menuCell?: MenuCellMap;
  /** Menu VOB WebMs */
  index?: string[];
  /** Title VOB WebMs (absent or partial on menus-mode rips) */
  video?: string[];
  vtt?: string[];
  extractMode?: 'menus' | 'full';
  /**
   * When present, only these title PGCs were encoded as short-cell segments
   * (menus mode). JumpTT to other PGCs in the domain shows “not included”.
   */
  titlePgcMedia?: {
    includedPgcs: number[];
    pgcTimeline: Record<string, { startSec: number; endSec: number }>;
    stubs?: Record<
      string,
      {
        kind: 'interactive' | 'skip';
        cellID?: number;
        vobID?: number;
        still?: string | null;
        css?: string | null;
        still_time?: number;
        buttons?: MenuButtonNav[];
        btn_nb?: number;
      }
    >;
  };
};

export type DiscMetadata = DomainMetadata[];

/** @deprecated Prefer MenuButtonNav */
export type ButtonNav = MenuButtonNav;
/** @deprecated Prefer MenuCellMeta */
export type MenuCellInfo = MenuCellMeta;
/** @deprecated Prefer MenuPgcEntry */
export type MenuEntry = MenuPgcEntry;
/** @deprecated Prefer DvdListItem */
export type CatalogueEntry = DvdListItem;
