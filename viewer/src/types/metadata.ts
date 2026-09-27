/** Converted disc metadata.json shape (menus-first pipeline). */

export interface ButtonNav {
  id?: number;
  up?: number;
  down?: number;
  left?: number;
  right?: number;
  auto_action_mode?: number;
}

export interface MenuCellInfo {
  still?: string;
  css?: string;
  btn_nb?: number;
  buttons?: ButtonNav[];
  hli_s_ptm?: number;
  hli_e_ptm?: number;
  start_sector?: number;
  end_sector?: number;
  startSec?: number;
  endSec?: number;
}

export interface MenuEntry {
  pgc: number;
  cellID?: number;
  vobID?: number;
  still_time?: number;
  cells?: unknown[];
}

export interface DomainMetadata {
  extractMode?: 'menus' | 'full';
  menu?: Record<string, MenuEntry[]>;
  menuCell?: Record<string, Record<string, MenuCellInfo>>;
  /** Menu VOB WebMs (motion menus). */
  index?: string[];
  /** Title VOB WebMs (absent or empty in menus-only rips). */
  video?: string[];
  vtt?: string[];
}

export type DiscMetadata = DomainMetadata[];

export interface CatalogueEntry {
  name: string;
  dir: string;
}
