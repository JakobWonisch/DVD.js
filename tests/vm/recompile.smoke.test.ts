import { describe, expect, it } from 'vitest';
import compile from '../../src/vm/recompile.ts';

type VmCommandList = { bytes: number[] }[] | null | undefined;

describe('vm/recompile smoke', () => {
  it('returns empty string for falsy command lists', () => {
    expect(compile(null as unknown as VmCommandList as never)).toBe('');
    expect(compile(undefined as unknown as VmCommandList as never)).toBe('');
  });

  it('returns a trailing newline for an empty command list', () => {
    expect(compile([] as never)).toBe('\n');
  });
});
