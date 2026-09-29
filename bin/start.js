#!/usr/bin/env node
/**
 * Serve converted discs and rebuild the Solid viewer when its sources change.
 * Use `pnpm start:server` for HTTP only, or `pnpm dev:viewer` for HMR on :5173.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const viteCli = join(root, 'node_modules/vite/bin/vite.js');
const children = [];
let shuttingDown = false;

function run(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    stopChildren(signal);
    process.exit(code ?? (signal ? 1 : 0));
  });
  return child;
}

function stopChildren(signal) {
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal || 'SIGTERM');
    }
  }
}

function onSignal(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  stopChildren(signal);
}

process.on('SIGINT', () => onSignal('SIGINT'));
process.on('SIGTERM', () => onSignal('SIGTERM'));

run(process.execPath, [
  viteCli,
  'build',
  '--watch',
  '--config',
  'viewer/vite.config.ts',
]);
run(process.execPath, [join(root, 'bin/http-server.js')]);
