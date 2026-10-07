/**
 * SPRM index ↔ named keys used by generateJavaScript / recompile.
 * Indices match libdvdnav registers.SPRM[] / VM.system_reg_abbr_table.
 */

export const SPRM_ABBR: readonly string[] = [
  'MENU_LANG', // 0
  'ASTN', // 1
  'SPSTN', // 2
  'AGLN', // 3
  'TTN', // 4
  'VTS_TTN', // 5
  'TT_PGCN', // 6
  'PTTN', // 7
  'HL_BTNN', // 8
  'NVTMR', // 9
  'NV_PGCN', // 10
  'AMXMD', // 11
  'CC_PLT', // 12
  'PLT', // 13
  'VIDEO_CFG', // 14
  'AUDIO_CFG', // 15
  'AUD_LANG', // 16
  'AUD_EXT', // 17
  'SPU_LANG', // 18
  'SPU_EXT', // 19
  'PREF_REG', // 20
  'SPRM21', // 21
  'SPRM22', // 22
  'SPRM23', // 23
] as const;

export function emptySprmArray(): number[] {
  return Array.from({ length: 24 }, () => 0);
}

export function emptyGprmArray(): number[] {
  return Array.from({ length: 16 }, () => 0);
}

export function emptyGprmModeArray(): number[] {
  return Array.from({ length: 16 }, () => 0);
}

/** Named sprm object → dense SPRM[24] array. */
export function sprmObjectToArray(sprm: Record<string, number>): number[] {
  const out = emptySprmArray();
  for (let i = 0; i < SPRM_ABBR.length; i++) {
    const key = SPRM_ABBR[i]!;
    if (Object.prototype.hasOwnProperty.call(sprm, key)) {
      out[i] = sprm[key]! & 0xffff;
    }
  }
  return out;
}

/** Dense SPRM[24] → named object (only abbr keys we use in runtime). */
export function sprmArrayToObject(sprm: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < SPRM_ABBR.length; i++) {
    out[SPRM_ABBR[i]!] = (sprm[i] ?? 0) & 0xffff;
  }
  return out;
}

/** Default player SPRMs matching generateJavaScript.ts init (approx). */
export function defaultSprmObject(): Record<string, number> {
  return {
    ASTN: 15,
    SPSTN: 62,
    AGLN: 1,
    TTN: 1,
    VTS_TTN: 1,
    TT_PGCN: 0,
    PTTN: 1,
    HL_BTNN: 1 * 0x400,
    NVTMR: 0,
    NV_PGCN: 0,
    AMXMD: 0,
    CC_PLT: 0,
    PLT: 15,
  };
}
