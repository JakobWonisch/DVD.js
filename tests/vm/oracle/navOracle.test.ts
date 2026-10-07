import { describe, expect, it } from 'vitest';
import { compareTraces } from './compareTraces.ts';
import { oracleBinaryExists } from './runDvdnavOracle.ts';
import { defaultShrekPaths, runNavPlay } from './runNavPlay.ts';
import { replayVmJs } from './replayVmJs.ts';

/**
 * Part 3 disc-path oracle. Runs when dvdnav-oracle is built and a corpus
 * exists (local Shrek paths, or DVDJS_NAV_CORPUS / DVDJS_NAV_WEB / DVDJS_NAV_SCRIPT).
 *
 * Set DVDJS_NAV_STRICT=0 to only require traces (skip position equality).
 */
function corpusPaths(): {
  videoTs: string;
  webVm: string;
  script: string;
  label: string;
} | null {
  const envTs = process.env.DVDJS_NAV_CORPUS;
  const envWeb = process.env.DVDJS_NAV_WEB;
  const envScript = process.env.DVDJS_NAV_SCRIPT;
  if (envTs && envWeb && envScript) {
    return { videoTs: envTs, webVm: envWeb, script: envScript, label: 'env' };
  }
  return defaultShrekPaths();
}

const paths = corpusPaths();
const enabled = oracleBinaryExists() && !!paths;
const strict = process.env.DVDJS_NAV_STRICT !== '0';

describe.skipIf(!enabled)('vm nav oracle (libdvdnav play vs vm.js replay)', () => {
  it(`${paths?.label ?? 'corpus'} smoke: settled positions match`, () => {
    const gold = runNavPlay({ videoTs: paths!.videoTs, script: paths!.script });
    const ours = replayVmJs({ vmJsPath: paths!.webVm, scriptPath: paths!.script });

    expect(gold.length).toBeGreaterThan(5);
    expect(ours.length).toBeGreaterThan(3);
    expect(gold.some((s) => s.event === 'still' && s.still === 255)).toBe(true);
    expect(gold.some((s) => s.event === 'input_activate')).toBe(true);

    const result = compareTraces(gold, ours);
    if (!result.ok) {
      console.warn(
        '[nav-oracle] settled-position divergence:\n' +
          result.diffs.map((d) => `  ${d}`).join('\n'),
      );
    }
    if (strict) {
      expect(result.ok, result.diffs.join('\n')).toBe(true);
    }
  });
});

describe.skipIf(enabled)('vm nav oracle (corpus missing)', () => {
  it('skips when oracle binary or Shrek corpus is unavailable', () => {
    expect(enabled).toBe(false);
  });
});
