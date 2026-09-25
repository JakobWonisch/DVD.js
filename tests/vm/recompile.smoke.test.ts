import { describe, expect, it } from 'vitest';
import compile from '../../src/vm/recompile.ts';

describe('vm/recompile smoke', () => {
  it('returns empty string for falsy command lists', () => {
    expect(compile(null as unknown as number[])).toBe('');
    expect(compile(undefined as unknown as number[])).toBe('');
  });

  it('returns a trailing newline for an empty command list', () => {
    expect(compile([])).toBe('\n');
  });
});
