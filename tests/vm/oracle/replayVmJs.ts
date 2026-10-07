import * as fs from 'node:fs';
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
};

/**
 * Headless replay of converted vm.js against the same .navscript used by
 * dvdnav-oracle play. setTimeout is synchronous (flush queue); stills with
 * still_time===255 wait for still_skip / activate; finite stills auto-post.
 */
export function replayVmJs(opts: ReplayOptions): NavTraceStep[] {
  const code = fs.readFileSync(opts.vmJsPath, 'utf8');
  const scriptText = fs.readFileSync(opts.scriptPath, 'utf8');
  const steps: NavTraceStep[] = [];
  let stepI = 0;

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
      /* best-effort: clear all pending — matches clearTimeout(t) usage */
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
      // Title post / JumpSS may throw on missing WebM paths or LU keys in
      // older vm.js; keep replaying so the oracle can surface position diffs.
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

  const dvd = {
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
      };
      g.domain = opts.domain;
      emit('cell', { vobID: active.vobID, cellID: active.cellID });
      if (active.still_time === 255) {
        // Infinite still — wait for activate / still_skip.
        emit('still', { still: 255 });
        return;
      }
      if (buttons.length > 0) {
        // Interactive motion menu: do not auto-onPost (cell cmds often
        // LinkPGN back into the same cell → would recurse forever).
        emit('still', { still: 255 });
        return;
      }
      if (active.still_time > 0 && active.still_time < 255) {
        emit('still', { still: active.still_time });
        const post = active.onPost;
        active.onPost = null;
        if (post) post();
        flushTimers();
        return;
      }
      // Buttonless motion: end segment → onPost (advance / PGC post).
      const post = active.onPost;
      active.onPost = null;
      if (post) post();
      flushTimers();
    },
    playMenuByID() {},
    playTitleCell(opts: any) {
      active = {
        domain: opts.domain | 0,
        vobID: opts.vobID | 0,
        cellID: opts.cellID | 0,
        buttons: [],
        still_time: opts.still_time | 0,
        onPost: typeof opts.onPost === 'function' ? opts.onPost : null,
      };
      g.pgcSpace = 'title';
      emit('cell');
      const post = active.onPost;
      active.onPost = null;
      safeCall(post);
      flushTimers();
    },
    playTitlePgc(domain: number, pgc: number) {
      // Mirrors dvdHost JumpTT entry. Short title PGCs (warnings, trivia
      // clips) drain via playCurrentTitleCell → onPost. Feature-length PGCs
      // stay in title space until the script still_skips / ends — matching
      // libdvdnav (Harry Potter activate → title; do not auto CallSS home).
      g.domain = domain;
      g.pgc = pgc;
      g.pgcSpace = 'title';
      g.cellN = 1;
      g.pgN = 1;
      emit('cell');
      const title = g.PGCIUT?.[domain]?.[pgc];
      const cells = title?.cells || [];
      const longTitle =
        cells.length > 4 ||
        cells.some(
          (c: any) =>
            Number(c.endSec || 0) - Number(c.startSec || 0) > 60,
        );
      if (longTitle) {
        // Hold like a playing title; script may still_skip to run post later.
        active = {
          domain,
          vobID: 0,
          cellID: 1,
          buttons: [],
          still_time: 255,
          onPost: title && typeof title.post === 'function' ? () => title.post() : null,
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
      // Entry via playByID during FP/menus often targets short title cells
      // that must post (Shrek VTS_05). Feature entry uses playTitlePgc.
      const title = g.PGCIUT?.[g.domain]?.[g.pgc];
      const cells = title?.cells || [];
      const longTitle =
        cells.length > 4 ||
        cells.some(
          (c: any) =>
            Number(c.endSec || 0) - Number(c.startSec || 0) > 60,
        );
      if (longTitle) {
        active = {
          domain: g.domain | 0,
          vobID: 0,
          cellID: g.cellN | 0,
          buttons: [],
          still_time: 255,
          onPost: title && typeof title.post === 'function' ? () => title.post() : null,
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
    guardTitleJump() {
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

  // Start First Play (vm.js defines fp_pgc but does not auto-call it).
  emit('start');
  if (typeof g.fp_pgc === 'function') {
    g.fp_pgc();
    flushTimers();
  }

  const runStillSkip = () => {
    emit('input_still_skip');
    if (active?.onPost) {
      const post = active.onPost;
      active.onPost = null;
      post();
      flushTimers();
    }
  };

  const activateButton = (button: number) => {
    // button 0 → current HL; else 1-based button id → btnCmd index button-1
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
      dvd._dvdjsFromButton = true;
      cmd();
      flushTimers();
    } else {
      // Infinite still with no button table — treat as still skip
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

  for (const raw of scriptText.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('pump')) {
      // Flush pending async nav; stills already emitted by playMenuCell.
      flushTimers();
      emit('pump_end', { blocks: 0, hit: true });
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
      emit('input_wait_skip');
      flushTimers();
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
