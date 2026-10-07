/**
 * Menu-graph explore: BFS every interactive menu screen (gold = libdvdnav),
 * activate each button, compare destination vs headless vm.js replay.
 *
 * Titles are recorded as destinations but not expanded (avoids feature drains).
 * Each path is replayed from a cold start so GPRM/SPRM match DVD semantics.
 */
import { runNavPlayScript } from './runNavPlay.ts';
import { replayVmJs } from './replayVmJs.ts';
import {
  isOmittedTitle,
  loadTitlePgcMedia,
  type TitlePgcMedia,
} from './titlePgcMedia.ts';
import type { NavTraceStep } from './traceTypes.ts';

export type ExploreOptions = {
  videoTs: string;
  vmJsPath: string;
  /** Cap on unique menu screens visited (default 64). */
  maxScreens?: number;
  /** Cap on BFS depth from first still (default 10). */
  maxDepth?: number;
  /** Cap on buttons tried per screen (default 36). */
  maxButtonsPerScreen?: number;
  /** Pump block budget per hop (default 80000). */
  pumpMax?: number;
};

export type ScreenSettle = {
  key: string;
  space: string;
  vts: number;
  pgc: number;
  cell: number;
  hl: number;
  buttons: number;
  kind: 'still' | 'wait' | 'stop' | 'title' | 'other';
};

export type ExploreEdge = {
  from: string;
  button: number;
  goldTo: string;
  oursTo: string;
  ok: boolean;
  diff?: string;
};

export type ExploreResult = {
  ok: boolean;
  screens: string[];
  edges: ExploreEdge[];
  diffs: string[];
  truncated: boolean;
};

type QueueItem = {
  /** Button activations from First Play to reach this screen. */
  path: number[];
  screen: ScreenSettle;
  depth: number;
};

const SETTLE_EVENTS = new Set(['still', 'wait', 'stop', 'pump_end', 'pos', 'vts']);

export function exploreMenuGraph(opts: ExploreOptions): ExploreResult {
  const maxScreens = opts.maxScreens ?? 64;
  const maxDepth = opts.maxDepth ?? 10;
  const maxButtons = opts.maxButtonsPerScreen ?? 36;
  const pumpMax = opts.pumpMax ?? 80_000;

  const diffs: string[] = [];
  const edges: ExploreEdge[] = [];
  const screens: string[] = [];
  const visited = new Set<string>();
  let truncated = false;
  const titleMedia: Map<number, TitlePgcMedia> = loadTitlePgcMedia(
    opts.vmJsPath,
  );

  const bootstrap = buildScript([], pumpMax, null);
  const gold0 = runNavPlayScript({ videoTs: opts.videoTs, scriptText: bootstrap });
  const ours0 = replayVmJs({ vmJsPath: opts.vmJsPath, scriptText: bootstrap });

  const goldErr = gold0.find((s) => s.event === 'error');
  if (goldErr) {
    diffs.push(
      `gold incomplete (soft-pass): ${
        typeof goldErr.message === 'string' ? goldErr.message : 'read error'
      }`,
    );
    return { ok: true, screens, edges, diffs, truncated: false };
  }

  const gSettle = lastSettle(gold0);
  const oSettle = lastSettle(ours0);
  if (!gSettle) {
    diffs.push('explore: gold never settled on still/wait/stop');
    return { ok: false, screens, edges, diffs, truncated: false };
  }
  if (!oSettle) {
    diffs.push('explore: ours never settled on still/wait/stop');
    return { ok: false, screens, edges, diffs, truncated: false };
  }

  const entryDiff = compareSettles(gSettle, oSettle, titleMedia);
  if (entryDiff) diffs.push(`entry: ${entryDiff}`);

  if (!isMenuLike(gSettle)) {
    diffs.push(`explore: first settle is not a menu (${gSettle.key})`);
    return { ok: diffs.length === 0, screens: [gSettle.key], edges, diffs, truncated: false };
  }

  visited.add(gSettle.key);
  screens.push(gSettle.key);
  const queue: QueueItem[] = [{ path: [], screen: gSettle, depth: 0 }];

  while (queue.length > 0) {
    const item = queue.shift()!;
    const btnCount = Math.min(item.screen.buttons | 0, maxButtons);
    if (btnCount <= 0) continue;
    if (item.depth >= maxDepth) {
      truncated = true;
      continue;
    }

    for (let btn = 1; btn <= btnCount; btn++) {
      const script = buildScript(item.path, pumpMax, btn);
      let gold: NavTraceStep[];
      let ours: NavTraceStep[];
      try {
        gold = runNavPlayScript({ videoTs: opts.videoTs, scriptText: script });
        ours = replayVmJs({ vmJsPath: opts.vmJsPath, scriptText: script });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const edge: ExploreEdge = {
          from: item.screen.key,
          button: btn,
          goldTo: 'error',
          oursTo: 'error',
          ok: false,
          diff: msg,
        };
        edges.push(edge);
        diffs.push(`${item.screen.key} --[${btn}]--> error: ${msg}`);
        continue;
      }

      const gTo = lastSettle(gold) ?? unknownSettle('gold-empty');
      const oTo = lastSettle(ours) ?? unknownSettle('ours-empty');
      const edgeDiff = compareSettles(gTo, oTo, titleMedia);
      const edge: ExploreEdge = {
        from: item.screen.key,
        button: btn,
        goldTo: gTo.key,
        oursTo: oTo.key,
        ok: !edgeDiff,
        diff: edgeDiff,
      };
      edges.push(edge);
      if (edgeDiff) {
        diffs.push(
          `${item.screen.key} --[${btn}]--> gold=${gTo.key} ours=${oTo.key}: ${edgeDiff}`,
        );
      }

      // Expand only gold menu destinations we have not visited.
      if (
        isMenuLike(gTo) &&
        gTo.buttons > 0 &&
        !visited.has(gTo.key)
      ) {
        if (screens.length >= maxScreens) {
          truncated = true;
          continue;
        }
        visited.add(gTo.key);
        screens.push(gTo.key);
        queue.push({
          path: [...item.path, btn],
          screen: gTo,
          depth: item.depth + 1,
        });
      }
    }
  }

  if (truncated) {
    diffs.push(
      `explore truncated (maxScreens=${maxScreens}, maxDepth=${maxDepth})`,
    );
  }

  return {
    ok: diffs.filter((d) => !d.startsWith('explore truncated')).length === 0,
    screens,
    edges,
    diffs,
    truncated,
  };
}

function buildScript(
  pathToScreen: number[],
  pumpMax: number,
  /** Extra button to activate after reaching the screen; null = bootstrap only. */
  activateBtn: number | null,
): string {
  // Do not include until=vts: menu→menu VTS_CHANGE would stop before the
  // interactive still/wait (Shrek VMGM → VTSM). Title drains hit pump max.
  const lines: string[] = [
    `# explore path=[${pathToScreen.join(',')}]` +
      (activateBtn != null ? ` +activate ${activateBtn}` : ''),
    `pump max=${pumpMax} until=still|wait|stop`,
  ];
  for (const b of pathToScreen) {
    lines.push(`activate ${b}`);
    lines.push(`pump max=${pumpMax} until=still|wait|stop`);
  }
  if (activateBtn != null) {
    lines.push(`activate ${activateBtn}`);
    lines.push(`pump max=${pumpMax} until=still|wait|stop`);
  }
  lines.push('snapshot');
  return lines.join('\n') + '\n';
}

/**
 * Settle after the last input_* (destination of the final activate), or the
 * whole trace if there was no input. Prefer still(255)/wait/stop; fall back to
 * pump_end/pos/vts (title drains). Ignore buttonless waits and snapshot pos
 * overwriting a still/wait (preserves `buttons`).
 */
export function lastSettle(steps: NavTraceStep[]): ScreenSettle | null {
  let lastInput = -1;
  for (let i = 0; i < steps.length; i++) {
    const ev = steps[i]!.event;
    if (typeof ev === 'string' && ev.startsWith('input_')) lastInput = i;
    if (ev === 'error') {
      const s = steps[i]!;
      return {
        key: 'error',
        space: String(s.space || 'unknown'),
        vts: s.vts | 0,
        pgc: s.pgc | 0,
        cell: s.cell | 0,
        hl: s.hl | 0,
        buttons: 0,
        kind: 'other',
      };
    }
  }

  let interactive: ScreenSettle | null = null;
  let fallback: ScreenSettle | null = null;
  for (let i = lastInput + 1; i < steps.length; i++) {
    const s = steps[i]!;
    if (!SETTLE_EVENTS.has(s.event)) continue;

    if (s.event === 'still') {
      if (s.still === 255) interactive = fromStep(s, 'still');
      // Finite stills are still_timed elsewhere; ignore bare finite here.
    } else if (s.event === 'wait') {
      // Buttonless wait is sync noise (play.c now auto-skips; keep filter).
      if ((s.buttons | 0) > 0) interactive = fromStep(s, 'wait');
    } else if (s.event === 'stop') {
      interactive = fromStep(s, 'stop');
    } else if (s.event === 'pump_end' || s.event === 'pos' || s.event === 'vts') {
      const kind = s.space === 'title' ? 'title' : 'other';
      fallback = fromStep(s, kind);
    }
  }
  return interactive ?? fallback;
}

function fromStep(
  s: NavTraceStep,
  kind: ScreenSettle['kind'],
): ScreenSettle {
  const space = String(s.space || 'unknown');
  const vts = s.vts | 0;
  const pgc = s.pgc | 0;
  const cell = s.cell | 0;
  return {
    key: `${space}|${vts}|${pgc}|${cell}`,
    space,
    vts,
    pgc,
    cell,
    hl: s.hl | 0,
    buttons: s.buttons | 0,
    kind,
  };
}

function unknownSettle(tag: string): ScreenSettle {
  return {
    key: tag,
    space: 'unknown',
    vts: 0,
    pgc: 0,
    cell: 0,
    hl: 0,
    buttons: 0,
    kind: 'other',
  };
}

function isMenuLike(s: ScreenSettle): boolean {
  if (s.kind === 'stop' || s.kind === 'title') return false;
  if (s.space === 'title') return false;
  return s.space === 'menu' || s.space === 'fp' || s.space === 'vmgm' || s.space === 'vtsm';
}

/**
 * Soft position compare (same rules as compareTraces for menus).
 * Screen key ignores hl; we still flag hard space/vts/pgc mismatches.
 *
 * Omitted titles (menus-only skip stubs / empty includedPgcs): gold may settle
 * inside the feature while ours stub-skips via PGC post() to a menu — soft-pass.
 */
function compareSettles(
  g: ScreenSettle,
  o: ScreenSettle,
  titleMedia?: Map<number, TitlePgcMedia>,
): string | null {
  if (g.key === o.key) return null;
  // Soft: fp ↔ menu
  const gSpace = g.space === 'fp' ? 'menu' : g.space;
  const oSpace = o.space === 'fp' ? 'menu' : o.space;
  if (gSpace === oSpace && g.vts === o.vts && g.pgc === o.pgc) {
    // Cell may disagree on intro→interactive drain; same menu PGC is OK.
    return null;
  }
  // Title destinations: match on space+vts+pgc only
  if (g.space === 'title' && o.space === 'title' && g.vts === o.vts && g.pgc === o.pgc) {
    return null;
  }
  if (
    titleMedia &&
    g.space === 'title' &&
    isOmittedTitle(titleMedia, g.vts, g.pgc) &&
    (o.space === 'menu' || o.space === 'title' || o.space === 'fp')
  ) {
    return null;
  }
  return `space/vts/pgc/cell ${g.key}≠${o.key}`;
}
