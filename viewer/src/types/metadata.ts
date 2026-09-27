/** Converted disc catalogue entry (`dvds.json`). */
export type DvdListItem = {
  name: string;
  dir: string;
};

/** Button adjacency from PCI btnit (1-based neighbor ids). */
export type MenuButtonNav = {
  id?: number;
  up?: number;
  down?: number;
  left?: number;
  right?: number;
  auto_action_mode?: number;
};

export type MenuCellMeta = {
  still?: string;
  css?: string;
  btn_nb?: number;
  buttons?: MenuButtonNav[];
  hli_s_ptm?: number;
  hli_e_ptm?: number;
};

export type MenuCellMap = Record<string, Record<string, MenuCellMeta>>;

export type MenuPgcEntry = {
  pgc: number;
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
  /** Title VOB WebMs (absent on menus-only rips) */
  video?: string[];
  vtt?: string[];
  extractMode?: 'menus' | 'full';
};

export type DiscMetadata = DomainMetadata[];
