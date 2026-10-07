import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import type { NavTraceStep } from './traceTypes.ts';
import { sprmObjectToArray } from './sprmMap.ts';

export type ReplayOptions = {
  vmJsPath: string;
  scriptPath: string;
};

type ActiveCell = {
  domain: number;
  vobID: number;
  cellID: number;
  buttons: Array<{ id: number; up?: number; down?: number; left?: number; right?: number }>;
  still_time: number;
  onPost: (() => void) | null;
  waiting: boolean;
};

type UntilKind = 'still' | 'wait' | 'stop' | 'vts' | 'cell' | 'highlight' | 'hop' | 'menu';

type TitleStub = { kind: 'skip' | 'interactive' };
type TitleMedia = {
  includedPgcs?: number[];
  stubs?: Record<string, TitleStub>;
};

/**
 * Headless replay of converted vm.js against the same .navscript used by
 * dvdnav-oracle play.
 *
 * Settle rules mirror play.c:
 * - still_time 255 → still
 * - still_time 1..254 → still_timed + auto-post
 * - still_time 0 + buttons → wait (auto wait_skip unless until includes wait)
 * - still_time 0 no buttons → onPost
 *
 * metadata.json `titlePgcMedia.stubs.kind=skip` → missing-title auto-skip
 * (Avatar language-menu escape), matching the viewer host.
 */
export function replayVmJs(opts: ReplayOptions): NavTraceStep[] {
  const code = fs.readFileSync(opts.vmJsPath, 'utf8');
  const scriptText = fs.readFileSync(opts.scriptPath, 'utf8');
  const titleMediaByDomain = loadTitlePgcMedia(opts.vmJsPath);
  const steps: NavTraceStep[] = [];
  let stepI = 0;
  let titleCellDepth = 0;
  const titleCellSeen = new Set<string>();
  const missingTitleSkip = new Set<string>();
  let missingTitleBroken = false;
  let missingTitleSkipCount = 0;

  const timers: Array<() => void> = [];
  const flushTimers = () => {
    let guard = 0;
    while (timers.length && guard++ < 10000) {
      const fn = timers.shift()!;
      fn();
    }
  };

  let active: ActiveCell | null = null;

  const g: Record<string, any> = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {}, trace() {} },
    Math,
    parseInt,
    Array,
    Object,
    String,
    Number,
    Boolean,
    JSON,
    Date,
    Error,
    localStorage: { getItem: () => null, setItem() {} },
    navigator: { language: 'en-US' },
    document: {
      addEventListener() {},
      removeEventListener() {},
      querySelectorAll: () => [],
      querySelector: () => null,
      createElement: () => ({ style: {}, dataset: {}, appendChild() {} }),
    },
    window: {},
    setTimeout: (fn: () => void, _ms?: number) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout: (_id?: number) => {
      timers.length = 0;
    },
  };
  g.window = g;
  g.globalThis = g;

  const safeCall = (fn: (() => void) | null | undefined) => {
    if (typeof fn !== 'function') return;
    try {
      fn();
    } catch (err) {
      steps.push({
        i: stepI++,
        event: 'error',
        space: g.pgcSpace === 'title' ? 'title' : 'menu',
        domain: g.domain === 0 ? 'vmgm' : 'vtsm',
        vts: g.domain | 0,
        title: 0,
        pgc: g.pgc | 0,
        pg: g.pgN | 0,
        cell: g.cellN | 0,
        hl: 0,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const emit = (event: string, extra: Record<string, unknown> = {}) => {
    const sprm = g.sprm || {};
    const hl = ((sprm.HL_BTNN || 0) >> 10) & 0x3f;
    const space =
      g.pgcSpace === 'title' ? 'title' : g.domain === 0 && !g.pgc ? 'fp' : 'menu';
    const domainName =
      space === 'title' ? 'title' : g.domain === 0 ? 'vmgm' : 'vtsm';
    steps.push({
      i: stepI++,
      event,
      space,
      domain: domainName,
      vts: g.domain | 0,
      title: sprm.TTN | 0,
      pgc: g.pgc | 0,
      pg: g.pgN | 0,
      cell: g.cellN | 0,
      hl: hl || 0,
      ...extra,
    });
  };

  /** Open VTS Root that linkPGCs by language cookie (Avatar). */
  const runLanguageDispatcherRoot = (): boolean => {
    const cookie = g.gprm?.[0x0b];
    if (!cookie) return false;
    const types = g.MENU_TYPES as
      | Array<Record<string, Array<{ domain: number; lang: string; pgc: number } | undefined>> | undefined>
      | undefined;
    if (!types) return false;
    for (let d = 0; d < types.length; d++) {
      const bucket = types[d];
      if (!bucket) continue;
      for (const lang of Object.keys(bucket)) {
        const root = bucket[lang]?.[3 /* Root */];
        if (!root) continue;
        const pgcObj = g.MPGCIUT?.[root.domain]?.[root.lang]?.[root.pgc];
        if (!pgcObj || typeof pgcObj.run !== 'function') continue;
        const preSrc =
          typeof pgcObj.pre === 'function'
            ? Function.prototype.toString.call(pgcObj.pre)
            : '';
        if (!/linkPGC\s*\(/.test(preSrc) || /VTT_TABLE|PTT_TABLE/.test(preSrc)) {
          continue;
        }
        const cells = pgcObj.cells;
        if (Array.isArray(cells) && cells.length === 0) {
          // Empty Root that only dispatches — good.
        }
        g.lang = root.lang;
        g.domain = root.domain;
        safeCall(() => pgcObj.run());
        flushTimers();
        return true;
      }
    }
    return false;
  };

  const escapeToVmgmTitleMenu = (): boolean => {
    const types = g.MENU_TYPES as
      | Array<Record<string, Array<{ domain: number; lang: string; pgc: number } | undefined>> | undefined>
      | undefined;
    if (!types?.[0]) return false;
    for (const lang of Object.keys(types[0])) {
      const title = types[0][lang]?.[2 /* Title */];
      if (!title) continue;
      const pgcObj = g.MPGCIUT?.[title.domain]?.[title.lang]?.[title.pgc];
      if (!pgcObj || typeof pgcObj.run !== 'function') continue;
      g.lang = title.lang;
      g.domain = 0;
      safeCall(() => pgcObj.run());
      flushTimers();
      return true;
    }
    // Fall back: any non-empty Root.
    for (let d = 0; d < (types?.length || 0); d++) {
      const bucket = types![d];
      if (!bucket) continue;
      for (const lang of Object.keys(bucket)) {
        const root = bucket[lang]?.[3];
        if (!root) continue;
        const pgcObj = g.MPGCIUT?.[root.domain]?.[root.lang]?.[root.pgc];
        if (!pgcObj?.cells?.length) continue;
        g.lang = root.lang;
        g.domain = root.domain;
        safeCall(() => pgcObj.run());
        flushTimers();
        return true;
      }
    }
    return false;
  };

  const afterLanguageCopyrightPost = (): boolean => {
    const hubTimer = g.t;
    if (!runLanguageDispatcherRoot()) return false;
    if (hubTimer != null && hubTimer !== g.t) {
      timers.length = 0;
    }
    return true;
  };

  const tryAutoSkipMissingTitle = (): boolean => {
    if (dvd._dvdjsFromButton) {
      missingTitleSkip.clear();
      missingTitleBroken = false;
      missingTitleSkipCount = 0;
      return false;
    }
    if (g.gprm?.[0x0b] && runLanguageDispatcherRoot()) {
      missingTitleSkip.clear();
      missingTitleBroken = false;
      missingTitleSkipCount = 0;
      return true;
    }
    const domain = g.domain;
    const pgc = g.pgc;
    const pgcObj = g.PGCIUT?.[domain]?.[pgc];
    if (!pgcObj || typeof pgcObj.post !== 'function') {
      missingTitleSkip.clear();
      return false;
    }
    const key = `${domain}:${pgc}`;
    missingTitleSkipCount++;
    // Two-node hub loops (PGC A ↔ PGC B) need a global cap, not only per-key.
    if (
      missingTitleBroken ||
      missingTitleSkip.has(key) ||
      missingTitleSkipCount > 8
    ) {
      missingTitleBroken = true;
      missingTitleSkip.add(key);
      if (!runLanguageDispatcherRoot()) escapeToVmgmTitleMenu();
      return true;
    }
    missingTitleSkip.add(key);
    safeCall(() => pgcObj.post());
    flushTimers();
    return true;
  };

  const runPendingPost = () => {
    if (!active?.onPost) return false;
    const post = active.onPost;
    active.onPost = null;
    active.waiting = false;
    safeCall(post);
    flushTimers();
    afterLanguageCopyrightPost();
    flushTimers();
    return true;
  };

  const getStub = (domain: number, pgc: number): TitleStub | null => {
    const stub = titleMediaByDomain.get(domain)?.stubs?.[String(pgc)];
    return stub && (stub.kind === 'skip' || stub.kind === 'interactive') ? stub : null;
  };

  const dvd: Record<string, any> = {
    _dvdjsFromButton: false,
    _dvdjsActiveMenu: null as any,
    beginUserButtonNav() {
      this._dvdjsFromButton = true;
    },
    playMenuCell(opts: any) {
      const buttons = opts.buttons || [];
      active = {
        domain: opts.domain | 0,
        vobID: opts.vobID | 0,
        cellID: opts.cellID | 0,
        buttons,
        still_time: opts.still_time | 0,
        onPost: typeof opts.onPost === 'function' ? opts.onPost : null,
        waiting: false,
      };
      g.domain = opts.domain;
      g.pgcSpace = 'menu';
      emit('cell', { vobID: active.vobID, cellID: active.cellID });

      if (active.still_time === 255) {
        emit('still', { still: 255 });
        return;
      }
      if (active.still_time > 0 && active.still_time < 255) {
        // Finite timed still — leave post pending; pump auto-skips (play.c)
        // after checking until=vts so VTS_CHANGE can stop first (Avatar).
        emit('still_timed', { still: active.still_time });
        return;
      }
      if (buttons.length > 0) {
        active.waiting = true;
        emit('wait');
        return;
      }
      runPendingPost();
    },
    playMenuByID() {},
    playTitleCell(opts: any) {
      const key = `${opts.domain | 0}:${g.pgc | 0}:${opts.cellID | 0}`;
      if (titleCellSeen.has(key) || titleCellDepth > 64) {
        active = {
          domain: opts.domain | 0,
          vobID: opts.vobID | 0,
          cellID: opts.cellID | 0,
          buttons: [],
          still_time: 255,
          onPost: null,
          waiting: false,
        };
        g.pgcSpace = 'title';
        emit('cell');
        return;
      }
      titleCellSeen.add(key);
      titleCellDepth++;
      active = {
        domain: opts.domain | 0,
        vobID: opts.vobID | 0,
        cellID: opts.cellID | 0,
        buttons: [],
        still_time: opts.still_time | 0,
        onPost: typeof opts.onPost === 'function' ? opts.onPost : null,
        waiting: false,
      };
      g.pgcSpace = 'title';
      emit('cell');
      const post = active.onPost;
      active.onPost = null;
      safeCall(post);
      flushTimers();
      titleCellDepth--;
    },
    playTitlePgc(domain: number, pgc: number) {
      g.domain = domain;
      g.pgc = pgc;
      g.pgcSpace = 'title';
      g.cellN = 1;
      g.pgN = 1;
      emit('cell');
      const title = g.PGCIUT?.[domain]?.[pgc];
      const stub = getStub(domain, pgc);

      if (stub?.kind === 'skip') {
        tryAutoSkipMissingTitle();
        afterLanguageCopyrightPost();
        flushTimers();
        return;
      }
      if (stub?.kind === 'interactive') {
        active = {
          domain,
          vobID: 0,
          cellID: pgc,
          buttons: [],
          still_time: 255,
          onPost: title && typeof title.post === 'function' ? () => title.post() : null,
          waiting: false,
        };
        emit('still', { still: 255 });
        return;
      }

      const cells = title?.cells || [];
      const longTitle =
        cells.length > 4 ||
        cells.some(
          (c: any) => Number(c.endSec || 0) - Number(c.startSec || 0) > 60,
        );
      if (longTitle) {
        active = {
          domain,
          vobID: 0,
          cellID: 1,
          buttons: [],
          still_time: 255,
          onPost: title && typeof title.post === 'function' ? () => title.post() : null,
          waiting: false,
        };
        return;
      }
      if (cells.length && typeof g.playCurrentTitleCell === 'function') {
        g.playCurrentTitleCell();
        flushTimers();
        return;
      }
      if (title && typeof title.post === 'function') {
        safeCall(() => title.post());
        flushTimers();
      }
    },
    playByID(id?: string) {
      g.pgcSpace = 'title';
      emit('pos');
      const title = g.PGCIUT?.[g.domain]?.[g.pgc];
      const stub = getStub(g.domain | 0, g.pgc | 0);
      if (stub?.kind === 'skip') {
        tryAutoSkipMissingTitle();
        afterLanguageCopyrightPost();
        flushTimers();
        return;
      }
      const cells = title?.cells || [];
      const longTitle =
        cells.length > 4 ||
        cells.some(
          (c: any) => Number(c.endSec || 0) - Number(c.startSec || 0) > 60,
        );
      if (longTitle) {
        active = {
          domain: g.domain | 0,
          vobID: 0,
          cellID: g.cellN | 0,
          buttons: [],
          still_time: 255,
          onPost: title && typeof title.post === 'function' ? () => title.post() : null,
          waiting: false,
        };
        return;
      }
      if (title && typeof title.post === 'function') {
        safeCall(() => title.post());
        flushTimers();
      }
      void id;
    },
    playChapter() {},
    guardTitleJump(_elementID?: string, pgc?: number) {
      if (!this._dvdjsFromButton) return true;
      const domain =
        Number(String(_elementID || '').replace(/^video-/, '')) || (g.domain | 0);
      if (getStub(domain, pgc as number)) return true;
      const media = titleMediaByDomain.get(domain);
      if (
        media?.includedPgcs &&
        pgc != null &&
        !media.includedPgcs.includes(pgc)
      ) {
        return false;
      }
      return true;
    },
    setMenuHighlight() {},
    flashMenuActivate() {},
    onmenu() {},
    addEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  g.dvd = dvd;

  vm.createContext(g);
  vm.runInContext(code, g, { filename: opts.vmJsPath, timeout: 10000 });

  emit('start');
  if (typeof g.fp_pgc === 'function') {
    g.fp_pgc();
    flushTimers();
  }

  const runStillSkip = () => {
    emit('input_still_skip');
    runPendingPost();
  };

  const runWaitSkip = () => {
    emit('input_wait_skip');
    runPendingPost();
  };

  const activateButton = (button: number) => {
    const hl = button > 0 ? button : ((g.sprm?.HL_BTNN || 0x400) >> 10) || 1;
    if (button > 0) {
      g.sprm.HL_BTNN = hl * 0x400;
    }
    emit('input_activate', { button: button || 0 });
    const domain = active?.domain ?? g.domain;
    const vob = active?.vobID;
    const cell = active?.cellID;
    const idx = hl - 1;
    const cmd =
      g.btnCmd?.[domain]?.[vob]?.[cell]?.[idx] ||
      g.btnCmd?.[domain]?.[vob]?.[idx];
    if (typeof cmd === 'function') {
      if (active) {
        active.onPost = null;
        active.waiting = false;
      }
      dvd._dvdjsFromButton = true;
      safeCall(cmd);
      flushTimers();
      // Leave _dvdjsFromButton set until the next pump so finite stills
      // along the button path stay pending (until=vts can stop first).
    } else if (g.pgcSpace === 'title') {
      return;
    } else {
      runStillSkip();
    }
  };

  const selectDir = (dir: string) => {
    emit('input_select', { dir });
    const buttons = active?.buttons || [];
    const current = ((g.sprm?.HL_BTNN || 0x400) >> 10) || 1;
    const entry = buttons[current - 1];
    if (!entry) return;
    let nextId: number | null = null;
    if (dir === 'up') nextId = entry.up ?? null;
    else if (dir === 'down') nextId = entry.down ?? null;
    else if (dir === 'left') nextId = entry.left ?? null;
    else if (dir === 'right') nextId = entry.right ?? null;
    if (nextId) {
      g.sprm.HL_BTNN = nextId * 0x400;
    }
    emit('pos');
  };

  const lastEvent = () => steps[steps.length - 1]?.event;

  const pumpUntil = (until: Set<UntilKind>, maxSteps: number) => {
    let guard = 0;
    let autoWaitSkips = 0;
    const domainAtStart = g.domain | 0;
    const spaceAtStart = g.pgcSpace;
    // Button path ended — pump may auto-skip finite stills / waits now.
    dvd._dvdjsFromButton = false;
    while (guard++ < maxSteps) {
      flushTimers();

      // Stop on VTS/domain change before auto-skipping stills (play.c order).
      if (
        until.has('vts') &&
        ((g.domain | 0) !== domainAtStart || g.pgcSpace !== spaceAtStart)
      ) {
        emit('pump_end', { blocks: 0, hit: true });
        return;
      }

      if (active?.waiting && active.onPost && !until.has('wait')) {
        // Cap auto-skips so LinkPGN motion-menu loops cannot run forever.
        if (++autoWaitSkips > 64) {
          emit('pump_end', { blocks: 0, hit: true });
          return;
        }
        runWaitSkip();
        continue;
      }

      // Finite timed stills: auto-skip during pump (play.c), unless we already
      // stopped for until=vts above.
      if (
        active &&
        active.onPost &&
        active.still_time > 0 &&
        active.still_time < 255
      ) {
        if (++autoWaitSkips > 64) {
          emit('pump_end', { blocks: 0, hit: true });
          return;
        }
        runStillSkip();
        continue;
      }

      const ev = lastEvent();
      if (until.has('wait') && (ev === 'wait' || active?.waiting)) {
        emit('pump_end', { blocks: 0, hit: true });
        return;
      }
      if (
        until.has('still') &&
        (ev === 'still' ||
          (active && active.still_time === 255 && !active.waiting))
      ) {
        emit('pump_end', { blocks: 0, hit: true });
        return;
      }
      if (until.has('stop') && ev === 'stop') {
        emit('pump_end', { blocks: 0, hit: true });
        return;
      }

      if (active?.still_time === 255 && !active.waiting) {
        emit('pump_end', { blocks: 0, hit: true });
        return;
      }
      if (!timers.length) {
        emit('pump_end', { blocks: 0, hit: true });
        return;
      }
    }
    emit('pump_end', { blocks: 0, hit: false });
  };

  for (const raw of scriptText.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('pump')) {
      const until = new Set<UntilKind>();
      let maxSteps = 80000;
      for (const part of line.slice(4).trim().split(/\s+/)) {
        if (part.startsWith('max=')) {
          maxSteps = Number.parseInt(part.slice(4), 10) || maxSteps;
        } else if (part.startsWith('until=')) {
          for (const tok of part.slice(6).split('|')) {
            if (tok) until.add(tok as UntilKind);
          }
        }
      }
      if (until.size === 0) {
        until.add('still');
        until.add('wait');
        until.add('stop');
      }
      pumpUntil(until, Math.min(maxSteps, 5000));
    } else if (line === 'snapshot') {
      emit('pos');
    } else if (line.startsWith('activate')) {
      const rest = line.slice('activate'.length).trim();
      activateButton(rest ? Number.parseInt(rest, 10) : 0);
    } else if (line.startsWith('select_button')) {
      const button = Number.parseInt(line.slice('select_button'.length).trim(), 10);
      g.sprm.HL_BTNN = button * 0x400;
      emit('input_select_button', { button });
      emit('pos');
    } else if (line.startsWith('select')) {
      selectDir(line.slice('select'.length).trim());
    } else if (line === 'still_skip') {
      runStillSkip();
    } else if (line === 'wait_skip') {
      runWaitSkip();
    } else if (line.startsWith('menu')) {
      const name = line.slice('menu'.length).trim();
      emit('input_menu', { menu: name });
      if (typeof g.dvd?.onmenu === 'function') {
        g.dvd.onmenu({});
        flushTimers();
      }
    } else {
      throw new Error(`replayVmJs: unknown script op: ${line}`);
    }
  }

  emit('end');
  void sprmObjectToArray;
  return steps;
}

function loadTitlePgcMedia(vmJsPath: string): Map<number, TitleMedia> {
  const out = new Map<number, TitleMedia>();
  const metaPath = path.join(path.dirname(vmJsPath), 'metadata.json');
  if (!fs.existsSync(metaPath)) return out;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<
      string,
      { titlePgcMedia?: TitleMedia }
    >;
    for (const [key, val] of Object.entries(meta)) {
      const d = Number(key);
      if (!Number.isFinite(d) || !val?.titlePgcMedia) continue;
      out.set(d, val.titlePgcMedia);
    }
  } catch {
    /* ignore */
  }
  return out;
}
