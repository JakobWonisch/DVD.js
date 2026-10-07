import { describe, expect, it } from 'vitest';
import { lastSettle, type ScreenSettle } from './exploreMenuGraph.ts';
import type { NavTraceStep } from './traceTypes.ts';

function step(
  partial: Partial<NavTraceStep> & Pick<NavTraceStep, 'event'>,
): NavTraceStep {
  return {
    i: 0,
    space: 'menu',
    vts: 0,
    pgc: 1,
    pg: 1,
    cell: 1,
    hl: 1,
    ...partial,
  };
}

describe('exploreMenuGraph lastSettle', () => {
  it('prefers still(255) after last activate and keeps buttons', () => {
    const steps = [
      step({ event: 'still', still: 255, buttons: 2, pgc: 1 }),
      step({ event: 'input_activate', button: 1 }),
      step({ event: 'still', still: 255, buttons: 6, vts: 1, pgc: 1, cell: 2 }),
      step({ event: 'pump_end', vts: 1, pgc: 1, cell: 2 }),
      step({ event: 'pos', vts: 1, pgc: 1, cell: 2 }),
    ];
    const s = lastSettle(steps) as ScreenSettle;
    expect(s.key).toBe('menu|1|1|2');
    expect(s.buttons).toBe(6);
    expect(s.kind).toBe('still');
  });

  it('ignores buttonless wait; accepts buttoned wait', () => {
    const steps = [
      step({ event: 'wait', buttons: 0 }),
      step({ event: 'wait', buttons: 4, pgc: 5, cell: 2 }),
      step({ event: 'pos', pgc: 5, cell: 2 }),
    ];
    const s = lastSettle(steps)!;
    expect(s.key).toBe('menu|0|5|2');
    expect(s.buttons).toBe(4);
    expect(s.kind).toBe('wait');
  });

  it('falls back to title pump_end when no still/wait after activate', () => {
    const steps = [
      step({ event: 'still', still: 255, buttons: 2 }),
      step({ event: 'input_activate', button: 1 }),
      step({
        event: 'pump_end',
        space: 'title',
        vts: 1,
        pgc: 3,
        cell: 1,
      }),
    ];
    const s = lastSettle(steps)!;
    expect(s.key).toBe('title|1|3|1');
    expect(s.kind).toBe('title');
  });
});
