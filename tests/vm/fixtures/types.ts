import type { BitField } from '../packCommand.ts';

export type FixtureStatus = 'ok' | 'stub' | 'missing' | 'bug';

export type OpcodeFixture = {
  id: string;
  group: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  ifVersion?: 1 | 2 | 3 | 4 | 5;
  conditional?: boolean;
  setImmediate?: boolean;
  linkNibble?: number;
  linkSub?: number;
  systemSetOp?: number;
  jumpSub?: number;
  setOp?: number;
  cmpOp?: number;
  /** Bit fields; bytes are derived via packCommand when omitted. */
  fields?: BitField[];
  /** Explicit bytes (overrides fields). */
  bytes?: number[];
  /** Desired compile body per DVD/libdvdnav semantics (not current stub output). */
  expect: string;
  /**
   * ok = current recompile already matches desired;
   * stub/bug/missing = recorded contract, asserted via it.todo until implemented.
   */
  status: FixtureStatus;
  refs: string[];
  notes?: string;
};

/** Collapse whitespace for stable compile() comparisons. */
export function normalizeJs(source: string): string {
  return source.replace(/\s+/g, ' ').trim();
}
