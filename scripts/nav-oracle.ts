#!/usr/bin/env node
/**
 * Run Part 3 nav oracle: libdvdnav play vs vm.js replay, print diff.
 *
 *   pnpm nav-oracle -- --video-ts dvds/Shrek --web web/Shrek/vm.js \
 *     --script tests/vm/oracle/scripts/shrek-smoke.navscript
 *
 * Full menu-graph explore (every screen + every button):
 *
 *   pnpm nav-oracle -- --video-ts dvds/Shrek --web web/Shrek/vm.js --explore
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareTraces } from '../tests/vm/oracle/compareTraces.ts';
import { exploreMenuGraph } from '../tests/vm/oracle/exploreMenuGraph.ts';
import { runNavPlay } from '../tests/vm/oracle/runNavPlay.ts';
import { replayVmJs } from '../tests/vm/oracle/replayVmJs.ts';
import { loadTitlePgcMedia } from '../tests/vm/oracle/titlePgcMedia.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv: string[]) {
  const out: {
    videoTs: string | null;
    web: string | null;
    script: string | null;
    explore: boolean;
    maxScreens: number | null;
    maxDepth: number | null;
    json: boolean;
    help?: boolean;
  } = {
    videoTs: null,
    web: null,
    script: null,
    explore: false,
    maxScreens: null,
    maxDepth: null,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') continue;
    if (a === '--video-ts') out.videoTs = argv[++i] ?? null;
    else if (a === '--web') out.web = argv[++i] ?? null;
    else if (a === '--script') out.script = argv[++i] ?? null;
    else if (a === '--explore') out.explore = true;
    else if (a === '--max-screens') out.maxScreens = Number(argv[++i]);
    else if (a === '--max-depth') out.maxDepth = Number(argv[++i]);
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (
  args.help ||
  !args.videoTs ||
  !args.web ||
  (!args.explore && !args.script)
) {
  console.log(`Usage:
  pnpm nav-oracle -- --video-ts PATH --web vm.js --script file.navscript [--json]
  pnpm nav-oracle -- --video-ts PATH --web vm.js --explore [--max-screens N] [--max-depth N] [--json]

Compares native libdvdnav play traces to headless vm.js replay.
--explore BFS-visits each menu screen and activates every button (titles are
destinations only, not expanded). Paths may be relative to the repo root.`);
  process.exit(args.help ? 0 : 2);
}

const videoTs = path.resolve(root, args.videoTs);
const web = path.resolve(root, args.web);

if (!fs.existsSync(videoTs)) {
  console.error('missing --video-ts', videoTs);
  process.exit(1);
}
if (!fs.existsSync(web)) {
  console.error('missing --web', web);
  process.exit(1);
}

if (args.explore) {
  const result = exploreMenuGraph({
    videoTs,
    vmJsPath: web,
    maxScreens: args.maxScreens ?? undefined,
    maxDepth: args.maxDepth ?? undefined,
  });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `explore screens=${result.screens.length} edges=${result.edges.length}` +
        (result.truncated ? ' (truncated)' : ''),
    );
    for (const s of result.screens) console.log(`  screen ${s}`);
    const bad = result.edges.filter((e) => !e.ok);
    console.log(`edges ok=${result.edges.length - bad.length} bad=${bad.length}`);
    if (result.ok) {
      console.log('OK — menu graph destinations match');
    } else {
      console.log('DIFF:');
      for (const d of result.diffs) console.log(' ', d);
      process.exitCode = 1;
    }
  }
} else {
  const script = path.resolve(root, args.script!);
  const gold = runNavPlay({ videoTs, script });
  const ours = replayVmJs({ vmJsPath: web, scriptPath: script });
  const result = compareTraces(gold, ours, {
    titleMediaByDomain: loadTitlePgcMedia(web),
  });

  if (args.json) {
    console.log(JSON.stringify({ ok: result.ok, diffs: result.diffs, gold, ours }, null, 2));
  } else {
    console.log(`gold steps=${gold.length} ours steps=${ours.length}`);
    console.log(
      `settled gold=${result.goldPositions.length} ours=${result.oursPositions.length}`,
    );
    if (result.ok) {
      console.log('OK — settled positions match');
    } else {
      console.log('DIFF:');
      for (const d of result.diffs) console.log(' ', d);
      process.exitCode = 1;
    }
  }
}
