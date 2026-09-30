import { describe, expect, it } from 'vitest';

import { mergeMenuCellMaps } from '../../src/server/convert/mergeMenuCellMaps.ts';

describe('mergeMenuCellMaps', () => {
  it('keeps button/CSS/SPU fields when stills rewrite the cell', () => {
    const existing = {
      '1': {
        '2': {
          css: '/disc/menu-0-1-2.css',
          btn_nb: 3,
          buttons: [{ id: 0, up: 1 }],
          hli_s_ptm: 90000,
          spu: '/disc/menu-0-1-2-spu.png',
          spuSelect: ['/disc/sel0.png'],
          spuActivate: ['/disc/act0.png'],
          spuFrameHeight: 480,
          still: '/disc/old.png',
          startSec: 0,
          endSec: 1,
        },
      },
    };
    const incoming = {
      '1': {
        '2': {
          still: '/disc/new.png',
          startSec: 0,
          endSec: 12.5,
          start_sector: 10,
          last_sector: 99,
        },
      },
    };

    const merged = mergeMenuCellMaps(existing, incoming);
    expect(merged['1']['2']).toEqual({
      still: '/disc/new.png',
      startSec: 0,
      endSec: 12.5,
      start_sector: 10,
      last_sector: 99,
      css: '/disc/menu-0-1-2.css',
      btn_nb: 3,
      buttons: [{ id: 0, up: 1 }],
      hli_s_ptm: 90000,
      spu: '/disc/menu-0-1-2-spu.png',
      spuSelect: ['/disc/sel0.png'],
      spuActivate: ['/disc/act0.png'],
      spuFrameHeight: 480,
    });
  });

  it('keeps cells only present on one side', () => {
    const merged = mergeMenuCellMaps(
      { '1': { '1': { css: '/a.css', btn_nb: 1 } } },
      { '2': { '1': { still: '/b.png' } } },
    );
    expect(merged['1']['1'].css).toBe('/a.css');
    expect(merged['2']['1'].still).toBe('/b.png');
  });

  it('preserves still when incoming omits it', () => {
    const merged = mergeMenuCellMaps(
      { '1': { '1': { still: '/old.png', startSec: 0 } } },
      { '1': { '1': { startSec: 0, endSec: 1, start_sector: 0 } } },
    );
    expect(merged['1']['1'].still).toBe('/old.png');
  });

  it('clears still when incoming sets still to null (transition)', () => {
    const merged = mergeMenuCellMaps(
      { '1': { '1': { still: '/old.png', css: '/a.css' } } },
      { '1': { '1': { still: null, startSec: 0, endSec: 2 } } },
    );
    expect(merged['1']['1'].still).toBeUndefined();
    expect(merged['1']['1'].css).toBe('/a.css');
  });
});
