import compile from '../../src/vm/recompile.ts';
import { cmd, packCommand } from './packCommand.ts';
import { opcodeFixtures } from './fixtures/opcodes.ts';
import { RUNTIME_GLOBALS, RUNTIME_NOTES, SPRM_KEYS } from './fixtures/runtimeContract.ts';
import { normalizeJs, type OpcodeFixture } from './fixtures/types.ts';
import { describe, expect, it } from 'vitest';

type VmCommand = { bytes: number[] };

function fixtureBytes(fixture: OpcodeFixture): number[] {
  if (fixture.bytes) {
    return fixture.bytes;
  }
  if (!fixture.fields) {
    throw new Error(`Fixture ${fixture.id} has neither bytes nor fields`);
  }
  return packCommand(fixture.fields);
}

function compiled(fixture: OpcodeFixture): string {
  return normalizeJs(compile([cmd(fixtureBytes(fixture))] as VmCommand[] as never));
}

describe('vm/recompile opcodes', () => {
  it('documents generateJavaScript runtime contract used by expects', () => {
    expect(RUNTIME_NOTES).toContain('LinkPGCN');
    expect(RUNTIME_GLOBALS).toContain('MPGCIUT');
    expect(SPRM_KEYS).toContain('HL_BTNN');
    expect(SPRM_KEYS).toContain('PLT');
  });

  it('covers every fixture with refs and a desired expect', () => {
    expect(opcodeFixtures.length).toBeGreaterThan(50);
    for (const fixture of opcodeFixtures) {
      expect(fixture.refs.length, fixture.id).toBeGreaterThan(0);
      expect(fixture.expect, fixture.id).toBeDefined();
      expect(fixtureBytes(fixture)).toHaveLength(8);
    }
  });

  it('JumpTT_1 bytes match recompile.ts seed [48,2,0,0,0,1,0,0]', () => {
    const jump = opcodeFixtures.find((f) => f.id === 'JumpTT_1');
    expect(jump).toBeDefined();
    expect(fixtureBytes(jump!)).toEqual([48, 2, 0, 0, 0, 1, 0, 0]);
  });

  it('status labels match whether compile() already equals desired expect', () => {
    const mismatches: string[] = [];
    for (const fixture of opcodeFixtures) {
      const matches = compiled(fixture) === normalizeJs(fixture.expect);
      if (fixture.status === 'ok' && !matches) {
        mismatches.push(
          `${fixture.id}: marked ok but compile differs\n  got:  ${compiled(fixture)}\n  want: ${normalizeJs(fixture.expect)}`,
        );
      }
      if (fixture.status !== 'ok' && matches) {
        mismatches.push(`${fixture.id}: marked ${fixture.status} but already matches desired`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  describe('desired emission', () => {
    for (const fixture of opcodeFixtures) {
      const title = `${fixture.id} [${fixture.status}]`;
      if (fixture.status === 'ok') {
        it(title, () => {
          expect(compiled(fixture)).toBe(normalizeJs(fixture.expect));
        });
      } else {
        // Desired contract is recorded on the fixture; flip to `it` when recompile implements it.
        it.todo(`${title} → ${normalizeJs(fixture.expect).slice(0, 100)}`);
      }
    }
  });

  describe('cross-check notes', () => {
    it('records SetAMXMD as writing SPRM 11 (mpucoder vmi44)', () => {
      const f = opcodeFixtures.find((x) => x.id === 'SetAMXMD_imm');
      expect(f?.status).toBe('missing');
      expect(normalizeJs(f!.expect)).toContain('sprm["AMXMD"]');
      expect(f?.refs.some((r) => /mpucoder|vmi44/i.test(r))).toBe(true);
    });

    it('records CallSS saving rsm_cell before jump', () => {
      const f = opcodeFixtures.find((x) => x.id === 'CallSS_FP');
      expect(normalizeJs(f!.expect)).toMatch(/rsm_cell\s*=\s*2/);
      expect(normalizeJs(f!.expect)).toContain('fp_pgc()');
    });

    it('records SetGPRMMD register and counter modes', () => {
      const counter = opcodeFixtures.find((x) => x.id === 'SetGPRMMD_counter');
      const reg = opcodeFixtures.find((x) => x.id === 'SetGPRMMD_register');
      expect(normalizeJs(counter!.expect)).toContain('gprm_mode[0x00] |= 1');
      expect(normalizeJs(reg!.expect)).toContain('gprm_mode[0x01] &= ~1');
    });

    it('records SetTmpPML+Goto desired parental + pc', () => {
      const f = opcodeFixtures.find((x) => x.id === 'SetTmpPML_plus_Goto');
      expect(normalizeJs(f!.expect)).toContain('sprm["PLT"]');
      expect(normalizeJs(f!.expect)).toContain('pc = 2');
    });

    it('documents SetNVTMR NV_PGCN width follows recompile/print not eval', () => {
      const f = opcodeFixtures.find((x) => x.id === 'SetNVTMR');
      expect(f?.notes).toMatch(/getbits\(30,\s*15\)/);
      expect(f?.notes).toMatch(/getbits\(23,\s*8\)/);
    });

    it('documents recompile-vs-eval non-goals on composite groups', () => {
      const composite = opcodeFixtures.filter((f) => f.group >= 4 && f.group <= 6);
      expect(composite.length).toBeGreaterThan(0);
      expect(composite.every((f) => f.refs.some((r) => /non-goal/i.test(r)))).toBe(true);
    });
  });
});
