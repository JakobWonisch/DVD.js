import { describe, expect, it } from 'vitest';

import {
  buttonGeomCss,
  buildStubButtonsFromNav,
  classifyTitlePgcStubs,
  titleFrameHeightFromIfo,
} from '../../src/server/convert/titleStubs.js';
import { TITLE_INCLUDE_MAX_SEC } from '../../src/server/convert/titleIncludePolicy.js';
import {
  getTitleStub,
  playSkipTitleStub,
} from '../../viewer/src/host/titleStubs.ts';

/** BCD time — decimal digits stored so dvdTimeToSeconds recovers them. */
function bcdTime(hour: number, minute: number, second: number) {
  return {
    hour: parseInt(String(hour), 16),
    minute: parseInt(String(minute), 16),
    second: parseInt(String(second), 16),
    frame_u: 0x40,
  };
}

function titleIfo(
  pgcs: Array<Array<{ durSec: number; start: number; last: number }>>,
) {
  return {
    vts_pgcit: {
      pgci_srp: pgcs.map(function (cells) {
        return {
          pgc: {
            cell_position: cells.map(function (_c, i) {
              return { cell_nr: i + 1, vob_id_nr: 1 };
            }),
            cell_playback: cells.map(function (c) {
              var m = Math.floor(c.durSec / 60);
              var s = Math.floor(c.durSec % 60);
              return {
                playback_time: bcdTime(0, m, s),
                first_sector: c.start,
                last_sector: c.last,
                still_time: 0,
              };
            }),
          },
        };
      }),
    },
  };
}

describe('classifyTitlePgcStubs', () => {
  it('marks omitted PGCs as skip when VOB NAV cannot be probed', () => {
    var ifo = titleIfo([
      [{ durSec: 30, start: 0, last: 50 }],
      [{ durSec: 600, start: 100, last: 9000 }],
    ]);
    // PGC 1 would be included if VOBs existed; without VOBs both are stubbed.
    var result = classifyTitlePgcStubs(ifo, [], [1]);
    expect(result.stubs['1']).toBeUndefined();
    expect(result.stubs['2']).toEqual({ kind: 'skip' });
    expect(result.interactive).toHaveLength(0);
  });

  it('stubs every PGC when none are included', () => {
    var ifo = titleIfo([
      [{ durSec: 120, start: 0, last: 500 }],
      [{ durSec: 200, start: 501, last: 1000 }],
    ]);
    var result = classifyTitlePgcStubs(ifo, [], []);
    expect(result.stubs['1']).toEqual({ kind: 'skip' });
    expect(result.stubs['2']).toEqual({ kind: 'skip' });
  });
});

describe('buildStubButtonsFromNav', () => {
  it('builds geometry + cmdBytes from PCI HLI', () => {
    var nav = {
      pci: {
        hli: {
          hl_gi: { btn_ns: 2 },
          btnit: [
            {
              x_start: 72,
              y_start: 48,
              x_end: 216,
              y_end: 96,
              up: 0,
              down: 2,
              left: 0,
              right: 0,
              auto_action_mode: 0,
              cmd: { bytes: [0x30, 0x02, 0, 0, 0, 1, 0, 0] },
            },
            {
              x_start: 72,
              y_start: 120,
              x_end: 216,
              y_end: 168,
              up: 1,
              down: 0,
              left: 0,
              right: 0,
              auto_action_mode: 0,
              cmd: { bytes: [0x20, 0, 0, 0, 0, 0, 0, 0] },
            },
          ],
        },
      },
    };
    var buttons = buildStubButtonsFromNav(nav as any, 480);
    expect(buttons).toHaveLength(2);
    expect(buttons[0].down).toBe(2);
    expect(buttons[0].cmdBytes[0]).toBe(0x30);
    expect(buttons[0].css).toContain('left:');
    expect(buttons[1].up).toBe(1);
  });
});

describe('buttonGeomCss / titleFrameHeightFromIfo', () => {
  it('uses title video_format for PAL', () => {
    expect(
      titleFrameHeightFromIfo({
        vtsi_mat: { vts_video_attr: { video_format: 1 } },
      }),
    ).toBe(576);
  });

  it('formats percent geometry', () => {
    var css = buttonGeomCss(
      { x_start: 0, y_start: 0, x_end: 360, y_end: 240 },
      480,
    );
    expect(css).toMatch(/width:50%/);
    expect(css).toMatch(/height:50%/);
  });
});

describe('getTitleStub / playSkipTitleStub', () => {
  it('reads stub by PGC key', () => {
    expect(
      getTitleStub(
        { stubs: { '3': { kind: 'skip' }, '4': { kind: 'interactive' } } },
        4,
      )?.kind,
    ).toBe('interactive');
    expect(getTitleStub({ stubs: { '3': { kind: 'skip' } } }, 9)).toBeNull();
  });

  it('playSkipTitleStub forces silent post even after a button latch', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    const post = vi.fn();
    const host: {
      _dvdjsFromButton?: boolean;
      _dvdjsMissingTitleSkip?: Set<string>;
    } = { _dvdjsFromButton: true };
    const ok = playSkipTitleStub(host, {
      domain: 1,
      pgc: 2,
      PGCIUT: { 1: { 2: { post } } },
    });
    expect(ok).toBe(true);
    expect(host._dvdjsFromButton).toBe(false);
    await vi.runAllTimersAsync();
    expect(post).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});

describe('TITLE_INCLUDE_MAX_SEC', () => {
  it('stays at 60s for short-cell policy', () => {
    expect(TITLE_INCLUDE_MAX_SEC).toBe(60);
  });
});
