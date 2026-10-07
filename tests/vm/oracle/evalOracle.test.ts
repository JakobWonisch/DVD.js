import { describe, expect, it } from 'vitest';
import { opcodeFixtures } from '../fixtures/opcodes.ts';
import { packCommand } from '../packCommand.ts';
import { compareEffects } from './compareEffects.ts';
import { emptyGprmArray, emptyGprmModeArray, emptySprmArray } from './sprmMap.ts';
import { oracleBinaryExists, runDvdnavOracle } from './runDvdnavOracle.ts';
import { runJsCommands } from './runJsCommand.ts';

function fixtureBytes(fixture: (typeof opcodeFixtures)[number]): number[] {
  if (fixture.bytes) return fixture.bytes;
  if (!fixture.fields) throw new Error(`${fixture.id}: no bytes/fields`);
  return packCommand(fixture.fields);
}

/** Fixtures that are not meaningful as single-command eval against libdvdnav. */
function skipReason(fixture: (typeof opcodeFixtures)[number]): string | null {
  if (fixture.status !== 'ok') {
    return `status=${fixture.status}`;
  }
  // Non-deterministic
  if (fixture.setOp === 8 || fixture.id.startsWith('Set_rnd')) {
    return 'rnd is non-deterministic';
  }
  // libdvdnav decoder.c eval_system_set has no case 4 (SetAMXMD); mpucoder/our recompile do.
  if (fixture.id.startsWith('SetAMXMD')) {
    return 'SetAMXMD not implemented in libdvdnav decoder.c';
  }
  // Invalid / diagnostic-only emissions
  if (
    /invalid|unknown|reserved/i.test(fixture.id) ||
    fixture.group === 7
  ) {
    return 'invalid/unknown opcode diagnostic';
  }
  // GoTo alone in a 1-cmd list: no register/link effect worth comparing
  if (fixture.id === 'GoTo_line5' || fixture.id === 'GoTo_conditional_eq') {
    return 'GoTo needs a multi-command list';
  }
  // SetTmpPML+Goto: parental SPRM + pc; compare registers only via multi-cmd later
  if (fixture.id === 'SetTmpPML_plus_Goto') {
    return 'SetTmpPML+Goto needs multi-command list';
  }
  // console.log stubs / unknown
  if (fixture.id === 'Special_invalid_4') {
    return 'invalid special';
  }
  return null;
}

/** Initial GPRMs chosen so arithmetic/set fixtures have a defined starting point. */
function initialRegsFor(fixture: (typeof opcodeFixtures)[number]): {
  gprm: number[];
  sprm: number[];
  gprm_mode: number[];
} {
  const gprm = emptyGprmArray();
  const sprm = emptySprmArray();
  const gprm_mode = emptyGprmModeArray();

  // Seed a few GPRMs for ops that read them
  gprm[0] = 10;
  gprm[1] = 3;
  gprm[2] = 7;
  gprm[3] = 0x1234;

  // Conditional fixtures often compare gprm[0] === 1
  if (fixture.conditional || fixture.id.includes('conditional') || fixture.id.includes('cmpOp')) {
    gprm[0] = 1;
  }

  // Div/mod need non-zero
  if (fixture.id.startsWith('Set_div') || fixture.id.startsWith('Set_mod')) {
    gprm[0] = 10;
  }

  // Sub: start above immediate
  if (fixture.id.startsWith('Set_sub')) {
    gprm[0] = 5;
  }

  return { gprm, sprm, gprm_mode };
}

const hasOracle = oracleBinaryExists();

describe.skipIf(!hasOracle)('vm eval oracle (libdvdnav vs recompile)', () => {
  it('oracle binary responds to a NOP', () => {
    const gold = runDvdnavOracle([[0, 0, 0, 0, 0, 0, 0, 0]]);
    expect(gold.jumped).toBe(false);
    expect(gold.link).toBeNull();
    expect(gold.gprm).toHaveLength(16);
    expect(gold.sprm).toHaveLength(24);
  });

  const runnable = opcodeFixtures.filter((f) => !skipReason(f));

  it(`covers ${runnable.length} ok fixtures (skipped ${opcodeFixtures.length - runnable.length})`, () => {
    expect(runnable.length).toBeGreaterThan(20);
  });

  for (const fixture of runnable) {
    it(`${fixture.id}`, () => {
      const bytes = fixtureBytes(fixture);
      const regs = initialRegsFor(fixture);

      const gold = runDvdnavOracle([bytes], regs);
      const ours = runJsCommands({ bytes: [bytes], regs });

      const result = compareEffects(gold, ours);
      if (!result.ok) {
        expect.fail(
          [
            `${fixture.id} effect mismatch`,
            ...result.diffs.map((d) => `  ${d}`),
            `  gold.link=${JSON.stringify(gold.link)}`,
            `  ours.link=${JSON.stringify(ours.link)} aliases=${ours.linkAliases}`,
          ].join('\n'),
        );
      }
    });
  }
});

describe.skipIf(hasOracle)('vm eval oracle (binary missing)', () => {
  it('documents how to build the oracle', () => {
    expect(oracleBinaryExists()).toBe(false);
    // Soft skip path: suite is skipped when binary exists; this branch reminds CI/local.
    console.warn(
      'dvdnav-oracle not built — run `pnpm build:dvdnav-oracle` (needs libdvdnav/libdvdread headers, e.g. nix develop)',
    );
  });
});
