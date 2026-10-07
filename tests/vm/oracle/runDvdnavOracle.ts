import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NavEffect, RegSnapshot } from './effectTypes.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const ORACLE_BIN = path.join(REPO_ROOT, 'tools/dvdnav-oracle/bin/dvdnav-oracle');

export function oracleBinaryPath(): string {
  return ORACLE_BIN;
}

export function oracleBinaryExists(): boolean {
  return fs.existsSync(ORACLE_BIN);
}

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Run vendored libdvdnav vmEval_CMD via the C oracle CLI.
 */
export function runDvdnavOracle(
  commands: number[][],
  regs?: RegSnapshot,
): NavEffect {
  if (!oracleBinaryExists()) {
    throw new Error(
      `dvdnav-oracle binary missing at ${ORACLE_BIN}. Run: pnpm build:dvdnav-oracle`,
    );
  }

  const args = ['eval'];
  for (const cmdBytes of commands) {
    if (cmdBytes.length !== 8) {
      throw new Error(`command must be 8 bytes, got ${cmdBytes.length}`);
    }
    args.push('--cmd', bytesToHex(cmdBytes));
  }
  if (regs?.gprm) {
    args.push('--gprm', regs.gprm.map((v) => String(v & 0xffff)).join(','));
  }
  if (regs?.sprm) {
    args.push('--sprm', regs.sprm.map((v) => String(v & 0xffff)).join(','));
  }
  if (regs?.gprm_mode) {
    args.push('--gprm-mode', regs.gprm_mode.map((v) => String(v & 0xff)).join(','));
  }

  const result = spawnSync(ORACLE_BIN, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `dvdnav-oracle exited ${result.status}: ${result.stderr || result.stdout}`,
    );
  }

  const line = (result.stdout || '').trim().split('\n').filter(Boolean).pop();
  if (!line) {
    throw new Error(`dvdnav-oracle produced no stdout (stderr: ${result.stderr})`);
  }

  const parsed = JSON.parse(line) as NavEffect;
  if (!Array.isArray(parsed.gprm) || parsed.gprm.length !== 16) {
    throw new Error('dvdnav-oracle JSON: gprm must be length 16');
  }
  if (!Array.isArray(parsed.sprm) || parsed.sprm.length !== 24) {
    throw new Error('dvdnav-oracle JSON: sprm must be length 24');
  }
  return parsed;
}
