import compile from '../../../src/vm/recompile.ts';
import { cmd } from '../packCommand.ts';
import type { NavEffect, NavLink, RegSnapshot } from './effectTypes.ts';
import {
  defaultSprmObject,
  emptyGprmArray,
  emptyGprmModeArray,
  sprmArrayToObject,
  sprmObjectToArray,
} from './sprmMap.ts';

export type JsRunOptions = {
  bytes: number[][];
  regs?: RegSnapshot;
  cellN?: number;
  pgN?: number;
  pgc?: number;
  domain?: number;
};

type LinkRecord = NavLink & { aliases?: string[] };

/**
 * Execute recompiled VM command body in a stub host and capture NavEffect.
 *
 * Initial cell/pg default to 5 so LinkPGN(2)/LinkCN(3) absolute sets are not
 * mistaken for LinkNextPG/LinkNextC (+1 from 1).
 */
export function runJsCommands(opts: JsRunOptions): NavEffect {
  const startCell = opts.cellN ?? 5;
  const startPg = opts.pgN ?? 5;
  const startPgc = opts.pgc ?? 5;
  const startDomain = opts.domain ?? 1;

  const gprm = pad16(opts.regs?.gprm ?? emptyGprmArray());
  const gprm_mode = pad16(opts.regs?.gprm_mode ?? emptyGprmModeArray());
  const sprmObj: Record<string, number> = {
    ...defaultSprmObject(),
    ...(opts.regs?.sprm ? sprmArrayToObject(opts.regs.sprm) : {}),
  };
  let hlAssigned = false;
  const sprm = new Proxy(sprmObj, {
    set(target, prop, value) {
      if (prop === 'HL_BTNN') hlAssigned = true;
      target[prop as string] = value as number;
      return true;
    },
    get(target, prop) {
      return target[prop as string];
    },
  });

  const env: Record<string, unknown> = {
    gprm,
    gprm_mode,
    sprm,
    cellN: startCell,
    pgN: startPg,
    pgc: startPgc,
    domain: startDomain,
    pgcSpace: 'menu',
    lang: 'en',
    rsm_cell: 0,
    rsm_vtsN: 0,
    rsm_pgcN: 0,
    rsm_regs: [0, 0, 0, 0, 0],
    t: null,
    Math,
    parseInt,
    console: { log() {}, error() {}, warn() {} },
  };

  let link: LinkRecord | null = null;
  let jumped = false;

  const setLink = (name: string, data1 = 0, data2 = 0, data3 = 0, aliases?: string[]) => {
    jumped = true;
    link = { command: -1, name, data1, data2, data3, aliases };
  };

  const buttonFromHl = () => ((sprmObj.HL_BTNN ?? 0) >> 10) & 0x3f;

  env.playCurrentMenuCell = () => {
    const button = buttonFromHl();
    const cellN = env.cellN as number;
    const pgN = env.pgN as number;
    if (cellN === startCell + 1 && pgN === startPg) {
      setLink('LinkNextC', button);
      return;
    }
    if (cellN === startCell - 1 && pgN === startPg) {
      setLink('LinkPrevC', button);
      return;
    }
    if (pgN === startPg + 1 && cellN === pgN) {
      setLink('LinkNextPG', button);
      return;
    }
    if (pgN === startPg - 1 && cellN === pgN) {
      setLink('LinkPrevPG', button);
      return;
    }
    if (cellN === startCell && pgN === startPg) {
      setLink('LinkTopC', button, 0, 0, ['LinkTopC', 'LinkTopPG']);
      return;
    }
    if (cellN === pgN && pgN !== startPg) {
      setLink('LinkPGN', pgN, button);
      return;
    }
    setLink('LinkCN', cellN, button);
  };

  env.linkPGC = (n: number) => {
    const button = buttonFromHl();
    if (n === startPgc) {
      setLink('LinkTopPGC', button, 0, 0, ['LinkTopPGC', 'LinkPGCN']);
    } else {
      setLink('LinkPGCN', n);
    }
    return 1;
  };

  env.linkPGCField = (field: string) => {
    const button = buttonFromHl();
    if (field === 'next_pgc') setLink('LinkNextPGC', button);
    else if (field === 'prev_pgc') setLink('LinkPrevPGC', button);
    else if (field === 'goup_pgc') setLink('LinkGoUpPGC', button);
    else setLink('Unknown');
    return 1;
  };

  env.currentPgcObject = () => ({
    next_pgc: startPgc + 1,
    prev_pgc: Math.max(1, startPgc - 1),
    goup_pgc: 1,
    post: () => setLink('LinkTailPGC', buttonFromHl()),
    run: () => {},
    cells: [{ cellID: 1, vobID: 1 }],
  });

  env.saveRSM = (cell?: number) => {
    env.rsm_cell = cell != null && cell !== 0 ? cell : env.cellN;
    env.rsm_vtsN = env.domain;
    env.rsm_pgcN = env.pgc;
    env.rsm_regs = [
      sprmObj.TTN,
      sprmObj.VTS_TTN,
      sprmObj.TT_PGCN,
      sprmObj.PTTN,
      sprmObj.HL_BTNN,
    ];
    setLink('CallSS_FP', env.rsm_cell as number, 0, 0, [
      'CallSS_FP',
      'CallSS_VMGM_MENU',
      'CallSS_VTSM',
      'CallSS_VMGM_PGC',
    ]);
  };

  env.resumeRSM = () => {
    setLink('LinkRSM', buttonFromHl());
    return 1;
  };

  env.fp_pgc = () => {
    if (!link || String(link.name).startsWith('CallSS')) {
      setLink('CallSS_FP', (env.rsm_cell as number) || 0, 0, 0, [
        'CallSS_FP',
        'JumpSS_FP',
      ]);
    } else {
      setLink('JumpSS_FP');
    }
  };

  // Depth: VTT_TABLE[ttn], PGCIUT[domain][pgc], PTT_TABLE[d][t][ptt], MENU/MPGCIUT[d][lang][x]
  env.VTT_TABLE = nestedProxy(1, (keys) => {
    const ttn = Number(keys[0]);
    setLink('JumpTT', ttn);
    return { domain: ttn, pgc: 1 };
  });

  env.PGCIUT = nestedProxy(2, () => ({ run() {} }));

  env.PTT_TABLE = nestedProxy(3, (keys) => {
    const title = Number(keys[1]);
    const pttIndex = Number(keys[2]);
    const ptt = pttIndex + 1;
    // LinkPTT sets HL_BTNN before touching PTT_TABLE; JumpVTS_* does not.
    if (hlAssigned) {
      setLink('LinkPTTN', ptt, buttonFromHl());
    } else if (!link) {
      if (pttIndex === 0) setLink('JumpVTS_TT', title);
      else setLink('JumpVTS_PTT', title, ptt);
    }
    return { domain: Number(keys[0]) || startDomain, pgc: 1, chapter: ptt };
  });

  env.MENU_TYPES = nestedProxy(3, (keys) => ({
    domain: Number(keys[0]) || 0,
    lang: 'en',
    pgc: Number(keys[2]) || 1,
  }));

  env.MPGCIUT = nestedProxy(3, (keys) => {
    const pgcKey = Number(keys[2]) || 1;
    return {
      run() {
        const rsm = env.rsm_vtsN as number;
        const rsmCell = (env.rsm_cell as number) || 0;
        if (rsm) {
          setLink('CallSS_VMGM_PGC', pgcKey, rsmCell, 0, [
            'CallSS_VMGM_PGC',
            'CallSS_VMGM_MENU',
            'CallSS_VTSM',
          ]);
        } else {
          setLink('JumpSS_VMGM_PGC', pgcKey, 0, 0, [
            'JumpSS_VMGM_PGC',
            'JumpSS_VMGM_MENU',
            'JumpSS_VTSM',
          ]);
        }
      },
    };
  });

  env.dvd = {
    playChapter() {},
    playByID() {},
    playMenuCell() {},
    playMenuByID() {},
    guardTitleJump: () => true,
    onmenu() {},
  };

  env.clearTimeout = () => {};
  env.setTimeout = (fn: () => void) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
    return 0;
  };

  const compiled = compile(opts.bytes.map((b) => cmd(b)) as never);
  const run = new Function(
    'env',
    `with (env) {\n${compiled}\n}\nreturn { ok: true };`,
  ) as (env: Record<string, unknown>) => unknown;

  let ret: unknown;
  try {
    ret = run(env);
  } catch (err) {
    throw err;
  }

  // Exit compiles to `return 1` which returns from the Function.
  if (ret === 1 && !jumped) {
    setLink('Exit');
  }

  return {
    jumped,
    gprm: gprm.map((v) => v & 0xffff),
    sprm: sprmObjectToArray(sprmObj),
    gprm_mode: gprm_mode.map((v) => v & 0xff),
    link: link
      ? {
          command: link.command,
          name: link.name,
          data1: link.data1,
          data2: link.data2,
          data3: link.data3,
        }
      : null,
    linkAliases: link?.aliases,
  };
}

function pad16(arr: number[]): number[] {
  const out = arr.slice(0, 16);
  while (out.length < 16) out.push(0);
  return out;
}

function nestedProxy(
  leafDepth: number,
  leaf: (keys: string[]) => unknown,
): unknown {
  const create = (keys: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (typeof prop === 'symbol') return undefined;
          const next = keys.concat(String(prop));
          if (next.length >= leafDepth) {
            return leaf(next);
          }
          return create(next);
        },
      },
    );
  return create([]);
}
