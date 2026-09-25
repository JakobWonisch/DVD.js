/**
 * Runtime globals emitted by generateJavaScript.ts that compiled VM JS may reference.
 * Fixture `expect` strings should use these APIs (not invented ones).
 */
export const RUNTIME_GLOBALS = [
  'lang',
  'domain',
  'pgc',
  'gprm',
  'sprm',
  'MPGCIUT',
  'PGCIUT',
  'VTT_TABLE',
  'PTT_TABLE',
  'MENU_TYPES',
  'dvd',
  't',
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
  'CC_PLT',
  'PLT',
] as const;

/**
 * Navigation return protocol used by pre/cell/btnCmd wrappers:
 * - `return 1` short-circuits further PGC steps
 * - Break is bare `return;`
 * - LinkPGCN uses clearTimeout/setTimeout(...run.bind(...)); return 1
 * - btnCmd wrappers prepend `domain = N;` before the compiled body
 */
export const RUNTIME_NOTES = `
generateJavaScript runtime contract:
- Globals: ${RUNTIME_GLOBALS.join(', ')}
- sprm keys: ${SPRM_KEYS.join(', ')}
- LinkPGCN: clearTimeout(t); t = setTimeout(MPGCIUT[domain][lang][N].run.bind(...)); return 1;
- JumpTT: VTT_TABLE[ttn] → PGCIUT[vtt.domain][vtt.pgc].run(); return 1;
- JumpVTS_*: PTT_TABLE + dvd.playChapter
- JumpSS VMGM menu / VTSM: MENU_TYPES[…] then MPGCIUT[menu.domain][menu.lang][menu.pgc]
- HL_BTNN at runtime is button_id * 0x0400
`.trim();
