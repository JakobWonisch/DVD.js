import type { BitField } from '../packCommand.ts';
import type { OpcodeFixture } from './types.ts';

const REF_MPU = 'http://www.mpucoder.com/DVD/vmindx.html';
const REF_WIKI = 'https://en.wikibooks.org/wiki/Inside_DVD-Video/Instruction_Set_Details';
const REF_DVDNAV = 'libdvdnav decoder.c / vmcmd.c (via src/vm/index.ts print path)';
const REF_NONGOAL =
  'recompile-vs-eval non-goal: do not golden against index.ts eval for groups 5–6 / if_version_3 / link_sub width';

function g0(op: number, extra: BitField[] = []): BitField[] {
  return [{ start: 63, count: 3, value: 0 }, { start: 51, count: 4, value: op }, ...extra];
}

function linkCmd(nibble: number, extra: BitField[] = []): BitField[] {
  return [
    { start: 63, count: 3, value: 1 },
    { start: 60, count: 1, value: 0 },
    { start: 51, count: 4, value: nibble },
    ...extra,
  ];
}

function linkSub(sub: number, button = 0): BitField[] {
  const fields = linkCmd(1, [{ start: 7, count: 8, value: sub }]);
  if (button) {
    fields.push({ start: 15, count: 6, value: button });
  }
  return fields;
}

function jumpCmd(op: number, extra: BitField[] = []): BitField[] {
  return [
    { start: 63, count: 3, value: 1 },
    { start: 60, count: 1, value: 1 },
    { start: 51, count: 4, value: op },
    ...extra,
  ];
}

function systemSet(op: number, immediate: boolean, extra: BitField[] = []): BitField[] {
  return [
    { start: 63, count: 3, value: 2 },
    { start: 59, count: 4, value: op },
    { start: 60, count: 1, value: immediate ? 1 : 0 },
    ...extra,
  ];
}

function setGprm(
  setOp: number,
  reg: number,
  immediate: boolean,
  dataOrReg: number,
  linkNibble = 0,
  extra: BitField[] = [],
): BitField[] {
  const fields: BitField[] = [
    { start: 63, count: 3, value: 3 },
    { start: 59, count: 4, value: setOp },
    { start: 60, count: 1, value: immediate ? 1 : 0 },
    { start: 35, count: 4, value: reg },
  ];
  if (immediate) {
    fields.push({ start: 31, count: 16, value: dataOrReg });
  } else {
    fields.push({ start: 23, count: 8, value: dataOrReg });
  }
  if (linkNibble) {
    fields.push({ start: 51, count: 4, value: linkNibble });
  }
  return [...fields, ...extra];
}

const LINK_TABLE: Array<{ sub: number; name: string; valid: boolean }> = [
  { sub: 0, name: 'LinkNoLink', valid: true },
  { sub: 1, name: 'LinkTopC', valid: true },
  { sub: 2, name: 'LinkNextC', valid: true },
  { sub: 3, name: 'LinkPrevC', valid: true },
  { sub: 4, name: 'invalid_4', valid: false },
  { sub: 5, name: 'LinkTopPG', valid: true },
  { sub: 6, name: 'LinkNextPG', valid: true },
  { sub: 7, name: 'LinkPrevPG', valid: true },
  { sub: 8, name: 'invalid_8', valid: false },
  { sub: 9, name: 'LinkTopPGC', valid: true },
  { sub: 10, name: 'LinkNextPGC', valid: true },
  { sub: 11, name: 'LinkPrevPGC', valid: true },
  { sub: 12, name: 'LinkGoUpPGC', valid: true },
  { sub: 13, name: 'LinkTailPGC', valid: true },
  { sub: 14, name: 'invalid_14', valid: false },
  { sub: 15, name: 'invalid_15', valid: false },
  { sub: 16, name: 'RSM', valid: true },
];

function linkSubFixtures(): OpcodeFixture[] {
  return LINK_TABLE.map(({ sub, name, valid }) => {
    if (!valid) {
      return {
        id: `LinkSub_${name}`,
        group: 1,
        linkNibble: 1,
        linkSub: sub,
        fields: linkSub(sub, 1),
        expect: `{ console.log('Unknown linksub instruction (${sub})'); }`,
        status: 'ok',
        refs: [REF_MPU, REF_DVDNAV],
        notes: 'Invalid link-sub opcode; current emission logs unknown.',
      };
    }
    if (sub === 1) {
      return {
        id: 'LinkTopC',
        group: 1,
        linkNibble: 1,
        linkSub: 1,
        fields: linkSub(1),
        expect: '{ return 1; }',
        status: 'ok',
        refs: [REF_MPU, REF_WIKI, REF_DVDNAV],
        notes: 'Runtime: return 1 short-circuits pre/cell.',
      };
    }
    if (sub === 13) {
      return {
        id: 'LinkTailPGC',
        group: 1,
        linkNibble: 1,
        linkSub: 13,
        fields: linkSub(13),
        expect: '{ MPGCIUT[domain][lang][pgc].post(); }',
        status: 'ok',
        refs: [REF_MPU, REF_WIKI, REF_DVDNAV],
      };
    }
    if (sub === 0) {
      return {
        id: 'LinkNoLink',
        group: 1,
        linkNibble: 1,
        linkSub: 0,
        fields: linkSub(0, 2),
        expect: `{ sprm["HL_BTNN"] = 2 * 0x0400; }`,
        status: 'ok',
        refs: [REF_MPU, REF_WIKI],
        notes: 'Highlight only when button nonzero; no transfer of control.',
      };
    }
    return {
      id: name,
      group: 1,
      linkNibble: 1,
      linkSub: sub,
      fields: linkSub(sub, 1),
      expect:
        sub === 16
          ? '{ sprm["HL_BTNN"] = 1 * 0x0400; /* RSM: resume at rsm_cell */ return 1; }'
          : `{ sprm["HL_BTNN"] = 1 * 0x0400; /* ${name} */ return 1; }`,
      status: new Set([2,3,5,6,7,9,10,11,12,16]).has(sub) ? 'ok' : 'stub',
      refs: [REF_MPU, REF_WIKI, REF_DVDNAV],
    };
  });
}

export const opcodeFixtures: OpcodeFixture[] = [
  // --- Group 0 special ---
  {
    id: 'NOP',
    group: 0,
    fields: g0(0),
    expect: '{ }',
    status: 'ok',
    refs: [REF_MPU, REF_WIKI, REF_DVDNAV],
    notes: 'libdvdnav NOP is a no-op; empty body (not console.log).',
  },
  {
    id: 'GoTo_line5',
    group: 0,
    fields: g0(1, [{ start: 7, count: 8, value: 5 }]),
    expect: 'var pc = 1; while(true) { switch(pc++) { case 1: { pc = 5; } break; default: return; } }',
    status: 'ok',
    refs: [REF_MPU, REF_WIKI, REF_DVDNAV],
  },
  {
    id: 'Break',
    group: 0,
    fields: g0(2),
    expect: '{ return; }',
    status: 'ok',
    refs: [REF_MPU, REF_WIKI, REF_DVDNAV],
  },
  {
    id: 'SetTmpPML_plus_Goto',
    group: 0,
    fields: g0(3, [
      { start: 11, count: 4, value: 8 },
      { start: 7, count: 8, value: 2 },
    ]),
    expect: '{ sprm["PLT"] /*Parental Level (SRPM:13)*/ = 8; pc = 2; }',
    status: 'ok',
    refs: [REF_MPU, REF_WIKI, REF_DVDNAV],
    notes:
      'mpucoder/libdvdnav: SetTmpPML sets SPRM[13] then Goto line.',
  },
  {
    id: 'Special_invalid_4',
    group: 0,
    fields: g0(4),
    expect: `{ console.log('Unknown special instruction (4)'); }`,
    status: 'ok',
    refs: [REF_MPU],
  },
  {
    id: 'GoTo_conditional_eq',
    group: 0,
    ifVersion: 1,
    conditional: true,
    cmpOp: 2,
    fields: [
      ...g0(1, [{ start: 7, count: 8, value: 3 }]),
      { start: 54, count: 3, value: 2 },
      { start: 39, count: 8, value: 0 },
      { start: 55, count: 1, value: 1 },
      { start: 31, count: 16, value: 1 },
    ],
    expect:
      'var pc = 1; while(true) { switch(pc++) { case 1: if (gprm[0x00] === 0x01) { pc = 3; } break; default: return; } }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
  },
  {
    id: 'if_version1_cmpOp0_no_predicate',
    group: 0,
    ifVersion: 1,
    cmpOp: 0,
    fields: g0(2),
    expect: '{ return; }',
    status: 'ok',
    refs: [REF_MPU],
    notes: 'cmp op 0 → no if () wrapper (if_version_1).',
  },
  {
    id: 'if_version2_cmpOp0_JumpTT',
    group: 1,
    ifVersion: 2,
    cmpOp: 0,
    fields: jumpCmd(2, [{ start: 22, count: 7, value: 1 }]),
    expect: '{ var vtt = VTT_TABLE[1]; PGCIUT[vtt.domain][vtt.pgc].run(); return 1; }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
    notes: 'if_version_2 with cmp op 0 (no predicate) on JumpTT.',
  },
  {
    id: 'if_version3_cmpOp0_Set',
    group: 3,
    ifVersion: 3,
    cmpOp: 0,
    setOp: 1,
    setImmediate: true,
    fields: setGprm(1, 0, true, 1),
    expect: '{ gprm[0x00] = 0x01; }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
  },

  // --- Group 1 links ---
  {
    id: 'LinkPGCN_3',
    group: 1,
    linkNibble: 4,
    fields: linkCmd(4, [{ start: 14, count: 15, value: 3 }]),
    expect:
      '{ clearTimeout(t); t = setTimeout(MPGCIUT[domain][lang][3].run.bind(MPGCIUT[domain][lang][3])); return 1; }',
    status: 'ok',
    refs: [REF_MPU, REF_WIKI, REF_DVDNAV],
  },
  {
    id: 'LinkPTTN',
    group: 1,
    linkNibble: 5,
    fields: linkCmd(5, [
      { start: 9, count: 10, value: 7 },
      { start: 15, count: 6, value: 1 },
    ]),
    expect:
      '{ sprm["HL_BTNN"] = 1 * 0x0400; var ptt = PTT_TABLE[domain][sprm["VTS_TTN"]][6]; PGCIUT[ptt.domain][ptt.pgc].run(); dvd.playChapter(ptt.chapter - 1); return 1; }',
    status: 'ok',
    refs: [REF_MPU, REF_WIKI, REF_DVDNAV],
    notes: 'LinkPTTN: highlight button then link to PTT in current VTS (pttn=7 → index 6).',
  },
  {
    id: 'LinkPGN',
    group: 1,
    linkNibble: 6,
    fields: linkCmd(6, [
      { start: 6, count: 7, value: 2 },
      { start: 15, count: 6, value: 1 },
    ]),
    expect: '{ sprm["HL_BTNN"] = 1 * 0x0400; /* LinkPGN 2 in current PGC */ return 1; }',
    status: 'stub',
    refs: [REF_MPU, REF_WIKI, REF_DVDNAV],
  },
  {
    id: 'LinkCN',
    group: 1,
    linkNibble: 7,
    fields: linkCmd(7, [
      { start: 7, count: 8, value: 3 },
      { start: 15, count: 6, value: 1 },
    ]),
    expect: '{ sprm["HL_BTNN"] = 1 * 0x0400; /* LinkCN 3 in current PGC */ return 1; }',
    status: 'stub',
    refs: [REF_MPU, REF_WIKI, REF_DVDNAV],
  },
  {
    id: 'Link_invalid_nibble_2',
    group: 1,
    linkNibble: 2,
    fields: linkCmd(2),
    expect: `{ console.log('Unknown link instruction (2)'); }`,
    status: 'ok',
    refs: [REF_MPU],
  },
    ...linkSubFixtures(),
  {
    id: 'LinkNoLink_button0',
    group: 1,
    linkNibble: 1,
    linkSub: 0,
    fields: linkSub(0, 0),
    expect: '{ }',
    status: 'ok',
    refs: [REF_MPU, REF_WIKI],
    notes: 'hl_bn 0 → leave HL_BTNN unchanged (wikibooks Link Subset).',
  },

  // --- Group 1 jumps / calls ---
  {
    id: 'Exit',
    group: 1,
    fields: jumpCmd(1),
    expect: '{ return 1; }',
    status: 'ok',
    refs: [REF_MPU, REF_WIKI, REF_DVDNAV],
    notes: 'Exit terminates playback; no console.log.',
  },
  {
    id: 'JumpTT_1',
    group: 1,
    fields: jumpCmd(2, [{ start: 22, count: 7, value: 1 }]),
    bytes: [48, 2, 0, 0, 0, 1, 0, 0],
    expect: '{ var vtt = VTT_TABLE[1]; PGCIUT[vtt.domain][vtt.pgc].run(); return 1; }',
    status: 'ok',
    refs: [REF_MPU, REF_WIKI, REF_DVDNAV],
  },
  {
    id: 'JumpVTS_TT',
    group: 1,
    fields: jumpCmd(3, [{ start: 22, count: 7, value: 2 }]),
    expect:
      '{ var vtt = PTT_TABLE[domain][2][0]; PGCIUT[vtt.domain][vtt.pgc].run(); dvd.playChapter(vtt.chapter - 1); return 1; }',
    status: 'ok',
    refs: [REF_MPU, REF_WIKI, REF_DVDNAV],
  },
  {
    id: 'JumpVTS_PTT',
    group: 1,
    fields: jumpCmd(5, [
      { start: 22, count: 7, value: 1 },
      { start: 41, count: 10, value: 3 },
    ]),
    expect:
      '{ var ptt = PTT_TABLE[domain][1][2]; PGCIUT[ptt.domain][ptt.pgc].run(); dvd.playChapter(ptt.chapter - 1); return 1; }',
    status: 'ok',
    refs: [REF_MPU, REF_WIKI, REF_DVDNAV],
    notes: 'recompile indexes ptt as getbits(41,10)-1.',
  },
  {
    id: 'Jump_invalid_4',
    group: 1,
    fields: jumpCmd(4),
    expect: `{ console.log('Unknown Jump/Call instruction (4)'); }`,
    status: 'ok',
    refs: [REF_MPU],
  },
  {
    id: 'JumpSS_FP',
    group: 1,
    jumpSub: 0,
    fields: jumpCmd(6, [{ start: 23, count: 2, value: 0 }]),
    expect: '{ fp_pgc(); return 1; }',
    status: 'ok',
    refs: [REF_MPU, REF_WIKI],
  },
  {
    id: 'JumpSS_VMGM_MENU',
    group: 1,
    jumpSub: 1,
    fields: jumpCmd(6, [
      { start: 23, count: 2, value: 1 },
      { start: 19, count: 4, value: 3 },
    ]),
    expect:
      '{ var menu = MENU_TYPES[0][lang][3]; clearTimeout(t); t = setTimeout(MPGCIUT[menu.domain][menu.lang][menu.pgc].run.bind(MPGCIUT[menu.domain][menu.lang][menu.pgc])); return 1; }',
    status: 'ok',
    refs: [REF_MPU, REF_WIKI, REF_DVDNAV],
  },
  {
    id: 'JumpSS_VTSM',
    group: 1,
    jumpSub: 2,
    fields: jumpCmd(6, [
      { start: 23, count: 2, value: 2 },
      { start: 30, count: 7, value: 1 },
      { start: 38, count: 7, value: 1 },
      { start: 19, count: 4, value: 3 },
    ]),
    expect:
      '{ var menu = MENU_TYPES[1][lang][3]; clearTimeout(t); t = setTimeout(MPGCIUT[menu.domain][menu.lang][menu.pgc].run.bind(MPGCIUT[menu.domain][menu.lang][menu.pgc])); return 1; }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
    notes:
      'Bit layout matches recompile/print (30/7, 38/7), not eval (31/8, 39/8). Uses current lang for menu lookup.',
  },
  {
    id: 'JumpSS_VMGM_PGC',
    group: 1,
    jumpSub: 3,
    fields: jumpCmd(6, [
      { start: 23, count: 2, value: 3 },
      { start: 46, count: 15, value: 5 },
    ]),
    expect:
      '{ clearTimeout(t); t = setTimeout(MPGCIUT[0][lang][5].run.bind(MPGCIUT[0][lang][5])); return 1; }',
    status: 'ok',
    refs: [REF_MPU, REF_WIKI, REF_DVDNAV],
  },
  {
    id: 'CallSS_FP',
    group: 1,
    jumpSub: 0,
    fields: jumpCmd(8, [
      { start: 23, count: 2, value: 0 },
      { start: 31, count: 8, value: 2 },
    ]),
    expect: '{ rsm_cell = 2; fp_pgc(); return 1; }',
    status: 'ok',
    refs: [REF_MPU, REF_WIKI],
    notes: 'CallSS saves resume cell then jumps (libdvdnav set_RSMinfo).',
  },
  {
    id: 'CallSS_VMGM_MENU',
    group: 1,
    jumpSub: 1,
    fields: jumpCmd(8, [
      { start: 23, count: 2, value: 1 },
      { start: 19, count: 4, value: 2 },
      { start: 31, count: 8, value: 1 },
    ]),
    expect:
      '{ rsm_cell = 1; var menu = MENU_TYPES[0][lang][2]; clearTimeout(t); t = setTimeout(MPGCIUT[menu.domain][menu.lang][menu.pgc].run.bind(MPGCIUT[menu.domain][menu.lang][menu.pgc])); return 1; }',
    status: 'ok',
    refs: [REF_MPU, REF_WIKI],
  },
  {
    id: 'CallSS_VTSM',
    group: 1,
    jumpSub: 2,
    fields: jumpCmd(8, [
      { start: 23, count: 2, value: 2 },
      { start: 19, count: 4, value: 3 },
      { start: 31, count: 8, value: 1 },
    ]),
    expect:
      '{ rsm_cell = 1; var menu = MENU_TYPES[domain][lang][3]; clearTimeout(t); t = setTimeout(MPGCIUT[menu.domain][menu.lang][menu.pgc].run.bind(MPGCIUT[menu.domain][menu.lang][menu.pgc])); return 1; }',
    status: 'ok',
    refs: [REF_MPU, REF_WIKI],
  },
  {
    id: 'CallSS_VMGM_PGC',
    group: 1,
    jumpSub: 3,
    fields: jumpCmd(8, [
      { start: 23, count: 2, value: 3 },
      { start: 46, count: 15, value: 4 },
      { start: 31, count: 8, value: 2 },
    ]),
    expect:
      '{ rsm_cell = 2; clearTimeout(t); t = setTimeout(MPGCIUT[0][lang][4].run.bind(MPGCIUT[0][lang][4])); return 1; }',
    status: 'ok',
    refs: [REF_MPU, REF_WIKI],
  },

  // --- Group 2 system set ---
  {
    id: 'SetSTN_ASTN_imm',
    group: 2,
    systemSetOp: 1,
    setImmediate: true,
    fields: systemSet(1, true, [
      { start: 39, count: 1, value: 1 },
      { start: 38, count: 7, value: 2 },
    ]),
    expect: '{ sprm["ASTN"] /*Audio Stream Number (SRPM:1)*/ = 0x02; }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
  },
  {
    id: 'SetSTN_SPSTN_imm',
    group: 2,
    systemSetOp: 1,
    setImmediate: true,
    fields: systemSet(1, true, [
      { start: 31, count: 1, value: 1 },
      { start: 30, count: 7, value: 3 },
    ]),
    expect: '{ sprm["SPSTN"] /*Sub-picture Stream Number (SRPM:2)*/ = 0x03; }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
  },
  {
    id: 'SetSTN_AGLN_imm',
    group: 2,
    systemSetOp: 1,
    setImmediate: true,
    fields: systemSet(1, true, [
      { start: 23, count: 1, value: 1 },
      { start: 22, count: 7, value: 1 },
    ]),
    expect: '{ sprm["AGLN"] /*Angle Number (SRPM:3)*/ = 0x01; }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
  },
  {
    id: 'SetSTN_ASTN_and_AGLN',
    group: 2,
    systemSetOp: 1,
    setImmediate: true,
    fields: systemSet(1, true, [
      { start: 39, count: 1, value: 1 },
      { start: 38, count: 7, value: 1 },
      { start: 23, count: 1, value: 1 },
      { start: 22, count: 7, value: 2 },
    ]),
    expect:
      '{ sprm["ASTN"] /*Audio Stream Number (SRPM:1)*/ = 0x01;sprm["AGLN"] /*Angle Number (SRPM:3)*/ = 0x02; }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
  },
  {
    id: 'SetSTN_ASTN_reg',
    group: 2,
    systemSetOp: 1,
    setImmediate: false,
    fields: systemSet(1, false, [
      { start: 39, count: 1, value: 1 },
      { start: 35, count: 4, value: 3 },
    ]),
    expect: '{ sprm["ASTN"] /*Audio Stream Number (SRPM:1)*/ = gprm[0x03]; }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
    notes: 'Non-immediate SetSTN: source is gprm nibble (compile_reg_or_data_2).',
  },
  {
    id: 'SetNVTMR',
    group: 2,
    systemSetOp: 2,
    setImmediate: true,
    fields: systemSet(2, true, [
      { start: 47, count: 16, value: 100 },
      { start: 30, count: 15, value: 5 },
    ]),
    expect:
      '{ sprm["NVTMR"] /*Navigation Timer (SRPM:9)*/ = 0x64; sprm["NV_PGCN"] /*Title PGC Number for Navigation Timer (SRPM:10)*/ = 5; }',
    status: 'bug',
    refs: [REF_MPU, REF_DVDNAV],
    notes:
      'Desired: semicolon between assignments. NV_PGCN width: recompile getbits(30,15); eval uses getbits(23,8) — fixtures follow recompile/print.',
  },
  {
    id: 'SetGPRMMD_counter',
    group: 2,
    systemSetOp: 3,
    setImmediate: true,
    fields: systemSet(3, true, [
      { start: 23, count: 1, value: 1 },
      { start: 19, count: 4, value: 0 },
      { start: 47, count: 16, value: 1 },
    ]),
    expect: '{ gprm_mode[0x00] |= 1; gprm[0x00] = 0x01; }',
    status: 'bug',
    refs: [REF_MPU, REF_DVDNAV],
    notes:
      'SetGPRMMD: set counter/register mode then assign (libdvdnav eval_system_set case 3).',
  },
  {
    id: 'SetGPRMMD_register',
    group: 2,
    systemSetOp: 3,
    setImmediate: true,
    fields: systemSet(3, true, [
      { start: 23, count: 1, value: 0 },
      { start: 19, count: 4, value: 1 },
      { start: 47, count: 16, value: 5 },
    ]),
    expect: '{ gprm_mode[0x01] &= ~1; gprm[0x01] = 0x05; }',
    status: 'bug',
    refs: [REF_MPU, REF_DVDNAV],
    notes: 'SetGPRMMD register mode clears counter bit then assigns.',
  },
  {
    id: 'SetAMXMD_imm',
    group: 2,
    systemSetOp: 4,
    setImmediate: true,
    fields: systemSet(4, true, [
      { start: 47, count: 16, value: 0 },
    ]),
    expect:
      '{ sprm["AMXMD"] /*Audio Mixing Mode for Karaoke (SRPM:11)*/ = 0x00; }',
    status: 'missing',
    refs: [REF_MPU, 'http://www.mpucoder.com/DVD/vmi44.html'],
    notes: 'System-set op 4 (SetAMXMD) writes SPRM 11 (mpucoder vmi44).',
  },
  {
    id: 'SetAMXMD_reg',
    group: 2,
    systemSetOp: 4,
    setImmediate: false,
    fields: systemSet(4, false, [
      { start: 19, count: 4, value: 2 },
    ]),
    expect:
      '{ sprm["AMXMD"] /*Audio Mixing Mode for Karaoke (SRPM:11)*/ = gprm[0x02]; }',
    status: 'missing',
    refs: [REF_MPU, 'http://www.mpucoder.com/DVD/vmi44.html'],
  },
  {
    id: 'SetAMXMD_plus_LinkPGCN',
    group: 2,
    systemSetOp: 4,
    setImmediate: true,
    linkNibble: 4,
    fields: [
      ...systemSet(4, true, [{ start: 47, count: 16, value: 0 }]),
      { start: 51, count: 4, value: 4 },
      { start: 14, count: 15, value: 1 },
    ],
    expect:
      '{ sprm["AMXMD"] /*Audio Mixing Mode for Karaoke (SRPM:11)*/ = 0x00; clearTimeout(t); t = setTimeout(MPGCIUT[domain][lang][1].run.bind(MPGCIUT[domain][lang][1])); return 1; }',
    status: 'missing',
    refs: [REF_MPU, 'http://www.mpucoder.com/DVD/vmi44.html'],
    notes: 'Optional post-set link after SetAMXMD (mpucoder K link field).',
  },
  {
    id: 'SystemSet_reserved_5',
    group: 2,
    systemSetOp: 5,
    fields: systemSet(5, false),
    expect: `{ console.log('Unknown system set instruction (5)'); }`,
    status: 'ok',
    refs: [REF_MPU],
  },
  {
    id: 'SetHL_BTNN_imm',
    group: 2,
    systemSetOp: 6,
    setImmediate: true,
    fields: systemSet(6, true, [{ start: 31, count: 16, value: 0x400 }]),
    expect:
      '{ sprm["HL_BTNN"] /*Highlighted Button Number (SRPM:8)*/ = 0x0400 /* (button 1) */; }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
  },
  {
    id: 'SetHL_BTNN_gprm',
    group: 2,
    systemSetOp: 6,
    setImmediate: false,
    fields: systemSet(6, false, [{ start: 19, count: 4, value: 3 }]),
    expect: '{ sprm["HL_BTNN"] /*Highlighted Button Number (SRPM:8)*/ = gprm[0x03]; }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
  },

  // --- Group 3 set ops ---
  {
    id: 'Set_mov_imm',
    group: 3,
    setOp: 1,
    setImmediate: true,
    fields: setGprm(1, 0, true, 1),
    expect: '{ gprm[0x00] = 0x01; }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
  },
  {
    id: 'Set_swap_bug',
    group: 3,
    setOp: 2,
    setImmediate: false,
    fields: setGprm(2, 0, false, 1),
    expect: '{ var temp = gprm[0x00]; gprm[0x00] = gprm[0x01]; gprm[0x01] = temp; }',
    status: 'bug',
    refs: [REF_MPU, REF_DVDNAV],
    notes: 'Current restores into gprm[0] twice instead of gprm[1].',
  },
  {
    id: 'Set_add_imm',
    group: 3,
    setOp: 3,
    setImmediate: true,
    fields: setGprm(3, 1, true, 5),
    expect: '{ gprm[0x01] += 0x05; }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
  },
  {
    id: 'Set_sub_imm',
    group: 3,
    setOp: 4,
    setImmediate: true,
    fields: setGprm(4, 0, true, 1),
    expect: '{ gprm[0x00] -= 0x01; }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
  },
  {
    id: 'Set_mul_imm',
    group: 3,
    setOp: 5,
    setImmediate: true,
    fields: setGprm(5, 0, true, 2),
    expect: '{ gprm[0x00] *= 0x02; }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
  },
  {
    id: 'Set_div_imm',
    group: 3,
    setOp: 6,
    setImmediate: true,
    fields: setGprm(6, 0, true, 2),
    expect: '{ gprm[0x00] = parseInt(gprm[0x00] / 0x02, 10); }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
  },
  {
    id: 'Set_mod_imm',
    group: 3,
    setOp: 7,
    setImmediate: true,
    fields: setGprm(7, 0, true, 3),
    expect: '{ gprm[0x00] %= 0x03; }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
  },
  {
    id: 'Set_rnd_imm',
    group: 3,
    setOp: 8,
    setImmediate: true,
    fields: setGprm(8, 0, true, 10),
    expect: '{ gprm[0x00] = 1 + Math.round((0x0A - 1) * Math.random()); }',
    status: 'bug',
    refs: [REF_MPU, REF_DVDNAV],
    notes: 'libdvdnav/vm: rnd returns 1..data inclusive.',
  },
  {
    id: 'Set_and_imm',
    group: 3,
    setOp: 9,
    setImmediate: true,
    fields: setGprm(9, 0, true, 0xff),
    expect: '{ gprm[0x00] &= 0xFF; }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
  },
  {
    id: 'Set_or_imm',
    group: 3,
    setOp: 10,
    setImmediate: true,
    fields: setGprm(10, 0, true, 1),
    expect: '{ gprm[0x00] |= 0x01; }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
  },
  {
    id: 'Set_xor_imm',
    group: 3,
    setOp: 11,
    setImmediate: true,
    fields: setGprm(11, 0, true, 1),
    expect: '{ gprm[0x00] ^= 0x01; }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
  },
  {
    id: 'Set_op0_NOP',
    group: 3,
    setOp: 0,
    fields: [
      { start: 63, count: 3, value: 3 },
      { start: 59, count: 4, value: 0 },
    ],
    expect: '{ }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
    notes: 'Set-op 0 is NOP; empty body (not console.log).',
  },
  {
    id: 'Set_mov_plus_LinkPGCN',
    group: 3,
    setOp: 1,
    linkNibble: 4,
    setImmediate: true,
    fields: [
      ...setGprm(1, 0, true, 1, 4),
      { start: 14, count: 15, value: 2 },
    ],
    expect:
      '{ gprm[0x00] = 0x01; clearTimeout(t); t = setTimeout(MPGCIUT[domain][lang][2].run.bind(MPGCIUT[domain][lang][2])); return 1; }',
    status: 'bug',
    refs: [REF_MPU, REF_DVDNAV],
    notes: 'Optional link after Set; desired single semicolon between statements.',
  },
  {
    id: 'Set_mov_reg_source',
    group: 3,
    setOp: 1,
    setImmediate: false,
    fields: setGprm(1, 2, false, 5),
    expect: '{ gprm[0x02] = gprm[0x05]; }',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV],
  },

  // --- Groups 4–6 composite ---
  {
    id: 'SetCLnk_group4_LinkTopC',
    group: 4,
    ifVersion: 4,
    setOp: 1,
    cmpOp: 2,
    linkSub: 1,
    setImmediate: true,
    fields: [
      { start: 63, count: 3, value: 4 },
      { start: 59, count: 4, value: 1 },
      { start: 60, count: 1, value: 1 },
      { start: 51, count: 4, value: 0 },
      { start: 47, count: 16, value: 9 },
      { start: 54, count: 3, value: 2 },
      { start: 55, count: 1, value: 1 },
      { start: 31, count: 16, value: 9 },
      { start: 7, count: 8, value: 1 },
    ],
    expect: 'gprm[0x00] = 0x09; if (gprm[0x00] === 0x09) { return 1; }',
    status: 'bug',
    refs: [REF_MPU, REF_DVDNAV, REF_NONGOAL],
    notes: 'SetCLnk: set then conditional LinkSub. Desired clean JS (no stray comma).',
  },
  {
    id: 'CSetCLnk_group5_LinkTailPGC',
    group: 5,
    ifVersion: 5,
    setImmediate: false,
    setOp: 1,
    cmpOp: 2,
    linkSub: 13,
    fields: [
      { start: 63, count: 3, value: 5 },
      { start: 59, count: 4, value: 1 },
      { start: 60, count: 1, value: 0 },
      { start: 51, count: 4, value: 0 },
      { start: 47, count: 16, value: 1 },
      { start: 54, count: 3, value: 2 },
      { start: 39, count: 8, value: 0 },
      { start: 55, count: 1, value: 1 },
      { start: 31, count: 16, value: 0 },
      { start: 7, count: 8, value: 13 },
    ],
    expect:
      'if (gprm[0x00] === 0x00) { gprm[0x00] = gprm[0x00]; MPGCIUT[domain][lang][pgc].post(); }',
    status: 'bug',
    refs: [REF_MPU, REF_DVDNAV, REF_NONGOAL],
    notes: 'CSetCLnk: if { set; linksub }. set_immediate=0 branch of if_version_5.',
  },
  {
    id: 'CSetCLnk_group5_set_immediate_1',
    group: 5,
    ifVersion: 5,
    setImmediate: true,
    setOp: 1,
    cmpOp: 2,
    linkSub: 13,
    fields: [
      { start: 63, count: 3, value: 5 },
      { start: 59, count: 4, value: 1 },
      { start: 60, count: 1, value: 1 },
      { start: 51, count: 4, value: 0 },
      { start: 47, count: 16, value: 1 },
      { start: 54, count: 3, value: 2 },
      { start: 31, count: 8, value: 0 },
      { start: 23, count: 8, value: 1 },
      { start: 7, count: 8, value: 13 },
    ],
    expect:
      'if (gprm[0x00] === gprm[0x01]) { gprm[0x00] = 0x01; MPGCIUT[domain][lang][pgc].post(); }',
    status: 'bug',
    refs: [REF_MPU, REF_DVDNAV, REF_NONGOAL],
    notes: 'set_immediate=1 alternate compare layout in if_version_5 (gprm vs gprm).',
  },
  {
    id: 'CSetLnk_group6_LinkTailPGC',
    group: 6,
    ifVersion: 5,
    setImmediate: false,
    setOp: 1,
    cmpOp: 2,
    linkSub: 13,
    fields: [
      { start: 63, count: 3, value: 6 },
      { start: 59, count: 4, value: 1 },
      { start: 60, count: 1, value: 0 },
      { start: 51, count: 4, value: 0 },
      { start: 47, count: 16, value: 1 },
      { start: 54, count: 3, value: 2 },
      { start: 39, count: 8, value: 0 },
      { start: 55, count: 1, value: 1 },
      { start: 31, count: 16, value: 0 },
      { start: 7, count: 8, value: 13 },
    ],
    expect:
      'if (gprm[0x00] === 0x00) { gprm[0x00] = gprm[0x00]; } MPGCIUT[domain][lang][pgc].post();',
    status: 'ok',
    refs: [REF_MPU, REF_DVDNAV, REF_NONGOAL],
    notes: 'CSetLnk: if { set } then linksub always outside if (mpucoder group 6).',
  },

  // --- Invalid / unknown group ---
  {
    id: 'group7_unknown',
    group: 7,
    fields: [{ start: 63, count: 3, value: 7 }],
    expect: '',
    status: 'ok',
    refs: [REF_MPU],
    notes: 'getbits(63,3)===7 hits default; emits empty command body.',
  },
];
