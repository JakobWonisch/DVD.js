/**
 * Runtime globals emitted by generateJavaScript.ts that compiled VM JS may reference.
 * Fixture `expect` strings should use these APIs (not invented ones).
 */
export const RUNTIME_GLOBALS = [
  'lang',
  'domain',
  'pgc',
  'pgN',
  'cellN',
  'gprm',
  'gprm_mode',
  'sprm',
  'rsm_cell',
  'rsm_vtsN',
  'rsm_pgcN',
  'rsm_regs',
  'saveRSM',
  'resumeRSM',
  'pgcSpace',
  'linkPGC',
  'linkPGCField',
  'currentPgcObject',
  'playCurrentMenuCell',
  'pickLang',
  'MPGCIUT',
  'PGCIUT',
  'VTT_TABLE',
  'PTT_TABLE',
  'MENU_TYPES',
  'dvd',
  't',
  'fp_pgc',
] as const;

/** sprm keys initialized in generateJavaScript.ts */
export const SPRM_KEYS = [
  'ASTN',
  'SPSTN',
  'AGLN',
  'TTN',
  'VTS_TTN',
  'TT_PGCN',
  'PTTN',
  'HL_BTNN',
  'NVTMR',
  'NV_PGCN',
  'AMXMD',
  'CC_PLT',
  'PLT',
  'MENU_LANG',
  'VIDEO_CFG',
  'AUDIO_CFG',
  'AUD_LANG',
  'AUD_EXT',
  'SPU_LANG',
  'SPU_EXT',
  'PREF_REG',
] as const;

/**
 * Navigation return protocol used by pre/cell/btnCmd wrappers:
 * - `return 1` short-circuits further PGC steps
 * - Break is bare `return;`
 * - LinkPGCN uses linkPGC(N); return 1 (menu vs title via pgcSpace)
 * - btnCmd wrappers prepend `domain = N;` before the compiled body
 */
export const RUNTIME_NOTES = `
generateJavaScript runtime contract:
- Globals: ${RUNTIME_GLOBALS.join(', ')}
- sprm keys: ${SPRM_KEYS.join(', ')}
- LinkPGCN: linkPGC(N); return 1 (menu → MPGCIUT, title → PGCIUT via pgcSpace)
- JumpTT: VTT_TABLE[ttn] → guardTitleJump then PGCIUT[vtt.domain][vtt.pgc].run(); return 1;
- JumpVTS_*: guardTitleJump then PTT_TABLE + dvd.playChapter
- JumpSS VMGM menu / VTSM: MENU_TYPES[…] then MPGCIUT[menu.domain][menu.lang][menu.pgc]
- HL_BTNN at runtime is button_id * 0x0400
- btnCmd/btnNav: [domain][vob_id][cell_id][buttonIndex] (cell required — same vob_id can host different button sets)
- cellN / pgN: LinkNextC/PrevC/PGN/CN and RSM mutate these; cell links call playCurrentMenuCell()
- CallSS: saveRSM(n) then jump; RSM: resumeRSM()
- LinkNextPGC / PrevPGC / GoUpPGC: linkPGCField("next_pgc"|"prev_pgc"|"goup_pgc")
- playCurrentMenuCell keeps pgN = cellN (and onPost sets both) so LinkNextPG after a transition cell does not need two presses
- playCurrentMenuCell onPost runs cellCmds[cell_cmd_nr-1] first (DVD play_Cell_post); return 1 stops; else advance cellN/pgN then PGC post
- Do not call cell() at PGC run() start — that skips transition cells (Harry Potter Scene Selection)
- LinkTailPGC: call post() then return 1
`.trim();
