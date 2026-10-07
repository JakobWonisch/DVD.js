/** Shared nav-effect schema for libdvdnav eval vs recompiled JS. */

export type LinkName =
  | 'LinkNoLink'
  | 'LinkTopC'
  | 'LinkNextC'
  | 'LinkPrevC'
  | 'LinkTopPG'
  | 'LinkNextPG'
  | 'LinkPrevPG'
  | 'LinkTopPGC'
  | 'LinkNextPGC'
  | 'LinkPrevPGC'
  | 'LinkGoUpPGC'
  | 'LinkTailPGC'
  | 'LinkRSM'
  | 'LinkPGCN'
  | 'LinkPTTN'
  | 'LinkPGN'
  | 'LinkCN'
  | 'Exit'
  | 'JumpTT'
  | 'JumpVTS_TT'
  | 'JumpVTS_PTT'
  | 'JumpSS_FP'
  | 'JumpSS_VMGM_MENU'
  | 'JumpSS_VTSM'
  | 'JumpSS_VMGM_PGC'
  | 'CallSS_FP'
  | 'CallSS_VMGM_MENU'
  | 'CallSS_VTSM'
  | 'CallSS_VMGM_PGC'
  | 'PlayThis'
  | 'Unknown';

export type NavLink = {
  command: number;
  name: LinkName | string;
  data1: number;
  data2: number;
  data3: number;
};

export type NavEffect = {
  jumped: boolean;
  gprm: number[];
  /** Full SPRM[0..23] numeric array (libdvdnav layout). */
  sprm: number[];
  gprm_mode: number[];
  link: NavLink | null;
  /** JS-only: aliases when emission cannot distinguish (e.g. TopC vs TopPG). */
  linkAliases?: string[];
};

export type RegSnapshot = {
  gprm?: number[];
  sprm?: number[];
  gprm_mode?: number[];
};
