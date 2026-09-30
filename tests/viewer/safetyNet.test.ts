import { describe, expect, it } from 'vitest';
import { cellShouldAutoAdvanceOnMediaFail } from '../../viewer/src/host/safetyNet.js';

describe('cellShouldAutoAdvanceOnMediaFail', function () {
  it('holds infinite stills for user input', function () {
    expect(
      cellShouldAutoAdvanceOnMediaFail({ still_time: 255, buttons: [] }),
    ).toBe(false);
    expect(
      cellShouldAutoAdvanceOnMediaFail({
        still_time: 255,
        buttons: [{}, {}],
      }),
    ).toBe(false);
  });

  it('advances timed stills even without buttons', function () {
    expect(
      cellShouldAutoAdvanceOnMediaFail({ still_time: 5, buttons: [] }),
    ).toBe(true);
  });

  it('advances still_time 0 only when there are no buttons', function () {
    expect(
      cellShouldAutoAdvanceOnMediaFail({ still_time: 0, buttons: [] }),
    ).toBe(true);
    expect(
      cellShouldAutoAdvanceOnMediaFail({ still_time: 0, buttons: [{}] }),
    ).toBe(false);
  });
});
