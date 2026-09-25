import { describe, expect, it } from 'vitest';
import {
  bytesToBitString,
  emptyCommand,
  getbits,
  getbitsFromBytes,
  packCommand,
  setBits,
} from './packCommand.ts';

describe('packCommand', () => {
  it('starts with eight zero bytes', () => {
    expect(emptyCommand()).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('maps bit 63 to the MSB of byte 0', () => {
    const bytes = emptyCommand();
    setBits(bytes, 63, 1, 1);
    expect(bytes[0]).toBe(0x80);
    expect(getbitsFromBytes(bytes, 63, 1)).toBe(1);
  });

  it('maps bit 0 to the LSB of byte 7', () => {
    const bytes = emptyCommand();
    setBits(bytes, 0, 1, 1);
    expect(bytes[7]).toBe(0x01);
    expect(getbitsFromBytes(bytes, 0, 1)).toBe(1);
  });

  it('round-trips arbitrary fields through getbits', () => {
    const cases: Array<{ start: number; count: number; value: number }> = [
      { start: 63, count: 3, value: 1 },
      { start: 60, count: 1, value: 1 },
      { start: 51, count: 4, value: 2 },
      { start: 22, count: 7, value: 1 },
      { start: 59, count: 4, value: 0xb },
      { start: 31, count: 16, value: 0x1234 },
      { start: 7, count: 8, value: 0xff },
    ];
    for (const { start, count, value } of cases) {
      const bytes = packCommand([{ start, count, value }]);
      expect(getbitsFromBytes(bytes, start, count)).toBe(value);
    }
  });

  it('preserves unrelated bits when setting a field', () => {
    const bytes = packCommand([
      { start: 63, count: 3, value: 3 },
      { start: 22, count: 7, value: 42 },
    ]);
    expect(getbitsFromBytes(bytes, 63, 3)).toBe(3);
    expect(getbitsFromBytes(bytes, 22, 7)).toBe(42);
  });

  it('returns 0 for zero-width getbits', () => {
    expect(getbits(bytesToBitString(emptyCommand()), 10, 0)).toBe(0);
  });

  it('reproduces JumpTT 1 seed bytes [48, 2, 0, 0, 0, 1, 0, 0]', () => {
    // Comment in recompile.ts:
    //   { bytes: [ 48, 2, 0, 0, 0, 1, 0, 0 ] } → JumpTT 1
    // group=1, jump bit=1, jump op=2 (JumpTT), ttn=1
    const bytes = packCommand([
      { start: 63, count: 3, value: 1 },
      { start: 60, count: 1, value: 1 },
      { start: 51, count: 4, value: 2 },
      { start: 22, count: 7, value: 1 },
    ]);
    expect(bytes).toEqual([48, 2, 0, 0, 0, 1, 0, 0]);
    expect(getbitsFromBytes(bytes, 63, 3)).toBe(1);
    expect(getbitsFromBytes(bytes, 60, 1)).toBe(1);
    expect(getbitsFromBytes(bytes, 51, 4)).toBe(2);
    expect(getbitsFromBytes(bytes, 22, 7)).toBe(1);
  });
});
