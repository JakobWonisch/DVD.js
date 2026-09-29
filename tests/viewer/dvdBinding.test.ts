import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * vm.js uses bare `dvd` (global lookup). `delete window.dvd` turns that into
 * ReferenceError — which is what hard-refresh / revisit after a prior disc hit.
 */
describe('window.dvd binding contract', () => {
  it('delete makes bare dvd throw ReferenceError; stub does not', () => {
    const g = globalThis as any;
    const prev = g.dvd;

    g.dvd = { ok: true };
    expect(g.dvd.ok).toBe(true);

    delete g.dvd;
    expect(() => {
      // eslint-disable-next-line no-unused-expressions
      (0, eval)('dvd.ok');
    }).toThrow(/dvd is not defined/);

    g.dvd = {
      addEventListener() {},
      querySelectorAll: () => [],
    };
    expect(() => {
      (0, eval)('dvd.addEventListener("keydown", function(){})');
    }).not.toThrow();

    if (prev === undefined) {
      delete g.dvd;
    } else {
      g.dvd = prev;
    }
  });

  it('generated init guards typeof dvd before _dvdjsVmInited', () => {
    const src = readFileSync(
      join(
        process.cwd(),
        'src/server/convert/generateJavaScript.ts',
      ),
      'utf8',
    );
    expect(src).toContain(
      'if (typeof dvd === "undefined" || !dvd) {',
    );
    expect(src).toContain('dvd._dvdjsKeyHandler = onDvdKeyDown');
    expect(src).not.toMatch(
      /function init\(\) \{\s*lang = pickLang\(0\) \|\| lang;\s*if \(dvd\._dvdjsVmInited\)/,
    );
  });
});
