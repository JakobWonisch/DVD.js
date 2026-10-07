import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NavTraceStep } from './traceTypes.ts';
import { oracleBinaryExists, oracleBinaryPath } from './runDvdnavOracle.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export type NavPlayOptions = {
  /** Disc root or VIDEO_TS directory. */
  videoTs: string;
  /** Path to .navscript file. */
  script: string;
};

export type NavPlayScriptOptions = {
  videoTs: string;
  /** Inline navscript body (stdin to dvdnav-oracle play). */
  scriptText: string;
};

/**
 * Run native libdvdnav play oracle; return parsed JSONL steps.
 */
export function runNavPlay(opts: NavPlayOptions): NavTraceStep[] {
  if (!fs.existsSync(opts.script)) {
    throw new Error(`navscript not found: ${opts.script}`);
  }
  return runNavPlayScript({
    videoTs: opts.videoTs,
    scriptText: fs.readFileSync(opts.script, 'utf8'),
  });
}

/**
 * Same as runNavPlay but with an inline script (explore path replay).
 */
export function runNavPlayScript(opts: NavPlayScriptOptions): NavTraceStep[] {
  if (!oracleBinaryExists()) {
    throw new Error(
      `dvdnav-oracle missing at ${oracleBinaryPath()}. Run: pnpm build:dvdnav-oracle`,
    );
  }
  if (!fs.existsSync(opts.videoTs)) {
    throw new Error(`VIDEO_TS / disc path not found: ${opts.videoTs}`);
  }

  const result = spawnSync(
    oracleBinaryPath(),
    ['play', '--path', opts.videoTs],
    {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      input: opts.scriptText,
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `dvdnav-oracle play exited ${result.status}:\n${result.stderr || result.stdout}`,
    );
  }

  return parseTraceJsonl(result.stdout || '');
}

export function parseTraceJsonl(text: string): NavTraceStep[] {
  const steps: NavTraceStep[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue; // ignore libdvdnav chatter on stdout
    steps.push(JSON.parse(t) as NavTraceStep);
  }
  return steps;
}

export function defaultShrekPaths(): {
  videoTs: string;
  webVm: string;
  script: string;
  label: string;
} | null {
  const root = path.resolve(HERE, '../../..');
  const videoTs = path.join(root, 'dvds/Shrek/VIDEO_TS');
  const webVm = path.join(root, 'web/Shrek/vm.js');
  const script = path.join(HERE, 'scripts/shrek-smoke.navscript');
  if (!fs.existsSync(videoTs) || !fs.existsSync(webVm) || !fs.existsSync(script)) {
    return null;
  }
  return { videoTs, webVm, script, label: 'Shrek' };
}

export function harryPotterPaths(): {
  videoTs: string;
  webVm: string;
  script: string;
  label: string;
} | null {
  const root = path.resolve(HERE, '../../..');
  const videoTs = path.join(
    root,
    'dvds/Harry Potter Philosophers Ston/VIDEO_TS',
  );
  const webVm = path.join(root, 'web/Harry_Potter_Philosophers_Ston/vm.js');
  const script = path.join(HERE, 'scripts/harry-potter-smoke.navscript');
  if (!fs.existsSync(videoTs) || !fs.existsSync(webVm) || !fs.existsSync(script)) {
    return null;
  }
  return { videoTs, webVm, script, label: 'Harry Potter' };
}
