import compile from '../../src/vm/recompile.ts';
import { cmd, packCommand } from './packCommand.ts';
import { normalizeJs } from './fixtures/types.ts';
import { describe, expect, it } from 'vitest';

type VmCommand = { bytes: number[] };

function gotoLine(line: number) {
  return cmd(
    packCommand([
      { start: 63, count: 3, value: 0 },
      { start: 51, count: 4, value: 1 },
      { start: 7, count: 8, value: line },
    ]),
  );
}

function brk() {
  return cmd(
    packCommand([
      { start: 63, count: 3, value: 0 },
      { start: 51, count: 4, value: 2 },
    ]),
  );
}

function mov(reg: number, value: number) {
  return cmd(
    packCommand([
      { start: 63, count: 3, value: 3 },
      { start: 59, count: 4, value: 1 },
      { start: 60, count: 1, value: 1 },
      { start: 35, count: 4, value: reg },
      { start: 31, count: 16, value: value },
    ]),
  );
}

function conditionalGoto(line: number, gprm: number, imm: number) {
  return cmd(
    packCommand([
      { start: 63, count: 3, value: 0 },
      { start: 51, count: 4, value: 1 },
      { start: 7, count: 8, value: line },
      { start: 54, count: 3, value: 2 },
      { start: 39, count: 8, value: gprm },
      { start: 55, count: 1, value: 1 },
      { start: 31, count: 16, value: imm },
    ]),
  );
}

function run(commands: VmCommand[]): string {
  return normalizeJs(compile(commands as never));
}

describe('vm/recompile GoTo multi-command', () => {
  it('wraps any list containing GoTo in a pc switch loop', () => {
    const out = run([gotoLine(2), brk()]);
    expect(out).toContain('var pc = 1;');
    expect(out).toContain('while(true)');
    expect(out).toContain('switch(pc++)');
    expect(out).toContain('case 1:');
    expect(out).toContain('case 2:');
    expect(out).toContain('default: return;');
  });

  it('supports forward GoTo', () => {
    // line1: GoTo 3; line2: Break; line3: Break
    const out = run([gotoLine(3), brk(), brk()]);
    expect(out).toContain('case 1: { pc = 3; } break;');
    expect(out).toContain('case 3: { return; } break;');
  });

  it('supports backward GoTo', () => {
    // line1: NOP-as-mov; line2: GoTo 1 — still emits pc switch because GoTo present
    const out = run([mov(0, 1), gotoLine(1)]);
    expect(out).toContain('case 2: { pc = 1; } break;');
  });

  it('GoTo past last line falls through to default return', () => {
    const out = run([gotoLine(99)]);
    expect(out).toContain('case 1: { pc = 99; } break;');
    expect(out).toContain('default: return;');
  });

  it('Break inside the pc loop exits the command section', () => {
    const out = run([brk(), gotoLine(1)]);
    expect(out).toContain('case 1: { return; } break;');
  });

  it('conditional GoTo emits if around pc assignment', () => {
    const out = run([conditionalGoto(2, 0, 1), brk()]);
    expect(out).toContain('case 1: if (gprm[0x00] === 0x01) { pc = 2; } break;');
  });

  it('SetTmpPML alone wraps in pc switch because it assigns pc', () => {
    const setTmpPml = cmd(
      packCommand([
        { start: 63, count: 3, value: 0 },
        { start: 51, count: 4, value: 3 },
        { start: 11, count: 4, value: 8 },
        { start: 7, count: 8, value: 2 },
      ]),
    );
    const out = run([setTmpPml, brk()]);
    expect(out).toContain('var pc = 1;');
    expect(out).toContain('while(true)');
    expect(out).toContain('sprm["PLT"]');
    expect(out).toContain('pc = 2;');
    expect(out).toContain('case 2:');
  });

  // Desired: NOP is empty inside the switch (libdvdnav no-op), not console.log.
  it.todo(
    'NOP in a GoTo program should compile to an empty case body: case N: { } break;',
  );
});
