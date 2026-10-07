import { describe, expect, it } from 'vitest';
import {
  findDirectPlayMenuPgcs,
  isChapterIndexHighlight,
  parsePlayCoverCmd,
  type MainTitleInfo,
} from '../../src/server/convert/findPlayTitleCoverCells.ts';
import {
  vmCmdBitString,
  vmGetbits,
} from '../../src/server/convert/vmCmdBits.ts';

/** Build an 8-byte Jump/Link command from field values (test helper). */
function makeCmd(opts: {
  type: number;
  bit60: number;
  op51: number;
  arg22?: number;
  arg14?: number;
  arg41?: number;
  arg46?: number;
  arg23?: number;
}): number[] {
  // Assemble via the same bit layout getbits reads — fill a 64-char string.
  const bits = Array(64).fill('0');
  function setBits(start: number, count: number, value: number) {
    const bin = value.toString(2).padStart(count, '0').slice(-count);
    for (let i = 0; i < count; i++) {
      bits[63 - start + i] = bin[i];
    }
  }
  setBits(63, 3, opts.type);
  setBits(60, 1, opts.bit60);
  setBits(51, 4, opts.op51);
  if (opts.arg22 != null) setBits(22, 7, opts.arg22);
  if (opts.arg14 != null) setBits(14, 15, opts.arg14);
  if (opts.arg41 != null) setBits(41, 10, opts.arg41);
  if (opts.arg46 != null) setBits(46, 15, opts.arg46);
  if (opts.arg23 != null) setBits(23, 2, opts.arg23);
  const str = bits.join('');
  const bytes: number[] = [];
  for (let i = 0; i < 8; i++) {
    bytes.push(parseInt(str.slice(i * 8, i * 8 + 8), 2));
  }
  return bytes;
}

const main: MainTitleInfo = {
  titleNr: 1,
  vts: 1,
  vtsTtn: 1,
  durationSec: 5000,
};

describe('vmCmdBits', () => {
  it('round-trips JumpTT title number', () => {
    const bytes = makeCmd({
      type: 1,
      bit60: 1,
      op51: 2,
      arg22: 7,
    });
    const bits = vmCmdBitString(bytes)!;
    expect(vmGetbits(bits, 63, 3)).toBe(1);
    expect(vmGetbits(bits, 60, 1)).toBe(1);
    expect(vmGetbits(bits, 51, 4)).toBe(2);
    expect(vmGetbits(bits, 22, 7)).toBe(7);
  });
});

describe('parsePlayCoverCmd', () => {
  it('parses Set GPRM + LinkPGCN (Avatar Play All button)', () => {
    // Real Avatar VTS1 main-menu btn0 bytes: Set + LinkPGCN 6
    expect(
      parsePlayCoverCmd({
        bytes: [113, 4, 0, 7, 0, 5, 0, 6],
      }),
    ).toEqual({ kind: 'LinkPGCN', arg: 6, ptt: 0 });
  });
});

describe('findDirectPlayMenuPgcs', () => {
  it('finds a trampoline PGC with JumpTT to the main title', () => {
    const jumpTT1 = makeCmd({ type: 1, bit60: 1, op51: 2, arg22: 1 });
    const ifo = {
      pgci_ut: {
        lu: [
          {
            pgcit: {
              pgci_srp: [
                { pgc: { command_tbl: null } },
                { pgc: { command_tbl: null } },
                {
                  pgc: {
                    command_tbl: {
                      pre_cmds: [{ bytes: jumpTT1 }],
                      post_cmds: [],
                      cell_cmds: [],
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    };
    expect([...findDirectPlayMenuPgcs(ifo, 0, main)]).toEqual([3]);
  });

  it('finds JumpVTS_PTT chapter 1 in the feature VTS', () => {
    const jumpPtt = makeCmd({
      type: 1,
      bit60: 1,
      op51: 5,
      arg22: 1,
      arg41: 1,
    });
    const ifo = {
      pgci_ut: {
        lu: [
          {
            pgcit: {
              pgci_srp: [
                {
                  pgc: {
                    command_tbl: {
                      pre_cmds: [{ bytes: jumpPtt }],
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    };
    expect([...findDirectPlayMenuPgcs(ifo, 1, main)]).toEqual([1]);
    expect([...findDirectPlayMenuPgcs(ifo, 2, main)]).toEqual([]);
  });

  it('follows LinkPGCN and JumpSS hops into a VMGM JumpTT trampoline', () => {
    const jumpTT1 = makeCmd({ type: 1, bit60: 1, op51: 2, arg22: 1 });
    const jumpSsVmgm12 = makeCmd({
      type: 1,
      bit60: 1,
      op51: 6,
      arg23: 3,
      arg46: 12,
    });
    const linkPgc6 = makeCmd({ type: 1, bit60: 0, op51: 4, arg14: 6 });
    const vmgmPlay = new Set([12]);
    // VTS domain: PGC6 JumpSS→VMGM12; PGC1 LinkPGCN→6
    const ifo = {
      pgci_ut: {
        lu: [
          {
            pgcit: {
              pgci_srp: [
                {
                  pgc: {
                    command_tbl: {
                      pre_cmds: [{ bytes: linkPgc6 }],
                    },
                  },
                },
                { pgc: { command_tbl: null } },
                { pgc: { command_tbl: null } },
                { pgc: { command_tbl: null } },
                { pgc: { command_tbl: null } },
                {
                  pgc: {
                    command_tbl: {
                      pre_cmds: [{ bytes: jumpSsVmgm12 }],
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    };
    expect([...findDirectPlayMenuPgcs(ifo, 1, main, vmgmPlay)].sort()).toEqual([
      1, 6,
    ]);
    // Sanity: VMGM PGC12 itself is direct play
    const vmg = {
      pgci_ut: {
        lu: [
          {
            pgcit: {
              pgci_srp: Array.from({ length: 12 }, (_, i) =>
                i === 11
                  ? {
                      pgc: {
                        command_tbl: { pre_cmds: [{ bytes: jumpTT1 }] },
                      },
                    }
                  : { pgc: { command_tbl: null } },
              ),
            },
          },
        ],
      },
    };
    expect([...findDirectPlayMenuPgcs(vmg, 0, main)]).toEqual([12]);
  });
});

describe('isChapterIndexHighlight', () => {
  it('detects multiple JumpVTS_PTT chapter targets', () => {
    const nav = {
      pci: {
        hli: {
          hl_gi: { btn_ns: 3 },
          btnit: [
            {
              cmd: {
                bytes: makeCmd({
                  type: 1,
                  bit60: 1,
                  op51: 5,
                  arg22: 1,
                  arg41: 1,
                }),
              },
            },
            {
              cmd: {
                bytes: makeCmd({
                  type: 1,
                  bit60: 1,
                  op51: 5,
                  arg22: 1,
                  arg41: 2,
                }),
              },
            },
            {
              cmd: {
                bytes: makeCmd({
                  type: 1,
                  bit60: 1,
                  op51: 5,
                  arg22: 1,
                  arg41: 3,
                }),
              },
            },
          ],
        },
      },
    };
    expect(isChapterIndexHighlight(nav)).toBe(true);
  });

  it('allows a single JumpVTS_PTT (Play from start)', () => {
    const nav = {
      pci: {
        hli: {
          hl_gi: { btn_ns: 2 },
          btnit: [
            {
              cmd: {
                bytes: makeCmd({
                  type: 1,
                  bit60: 0,
                  op51: 4,
                  arg14: 8,
                }),
              },
            },
            {
              cmd: {
                bytes: makeCmd({
                  type: 1,
                  bit60: 1,
                  op51: 5,
                  arg22: 1,
                  arg41: 1,
                }),
              },
            },
          ],
        },
      },
    };
    expect(isChapterIndexHighlight(nav)).toBe(false);
  });
});
