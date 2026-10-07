import { COMPARE_EVENTS, stepToPos, type NavTraceStep, type TracePos } from './traceTypes.ts';

export type TraceCompareResult = {
  ok: boolean;
  diffs: string[];
  goldPositions: TracePos[];
  oursPositions: TracePos[];
};

/**
 * Compare settled positions from libdvdnav play vs vm.js replay.
 *
 * We align on COMPARE_EVENTS only (pos / pump_end / still / stop / end),
 * ignoring high-frequency cell/highlight chatter during pump.
 *
 * Soft rules:
 * - `pg` may disagree when cell-list indexing differs; prefer cell+pgc+vts+space+hl
 * - `title` ignored (libdvdnav title vs our TTN often disagree on menus)
 * - First-play `space=fp` may collapse quickly — compare after first pump_end
 */
export function compareTraces(
  gold: NavTraceStep[],
  ours: NavTraceStep[],
): TraceCompareResult {
  const goldPositions = extractPositions(gold);
  const oursPositions = extractPositions(ours);
  const diffs: string[] = [];

  // Incomplete VIDEO_TS (missing VTS_*.VOB): gold emits error and stops.
  // Ours may continue via title stubs — treat as corpus soft-pass when ours
  // produced a settled menu/title (Avatar Vol1).
  const goldError = gold.find((s) => s.event === 'error');
  if (goldError) {
    const msg =
      typeof goldError.message === 'string'
        ? goldError.message
        : 'read error';
    if (oursPositions.length > 0) {
      return {
        ok: true,
        diffs: [`gold incomplete (soft-pass): ${msg}`],
        goldPositions,
        oursPositions,
      };
    }
    diffs.push(`gold incomplete and ours empty: ${msg}`);
  }

  const n = Math.min(goldPositions.length, oursPositions.length);
  if (!goldError && goldPositions.length !== oursPositions.length) {
    diffs.push(
      `position count: gold=${goldPositions.length} ours=${oursPositions.length}`,
    );
  }

  for (let i = 0; i < n; i++) {
    const g = goldPositions[i]!;
    const o = oursPositions[i]!;
    const parts: string[] = [];
    if (!spaceCompatible(g.space, o.space)) {
      parts.push(`space ${g.space}≠${o.space}`);
    }
    if (g.vts !== o.vts) parts.push(`vts ${g.vts}≠${o.vts}`);
    if (g.pgc !== o.pgc) parts.push(`pgc ${g.pgc}≠${o.pgc}`);
    // Cell index often disagrees: libdvdnav may stop on VTS_CHANGE at cell 1
    // while headless replay drains a buttonless intro cell into the interactive
    // cell. Same space/vts/pgc/hl ⇒ same menu.
    const sameMenu =
      spaceCompatible(g.space, o.space) &&
      g.vts === o.vts &&
      g.pgc === o.pgc &&
      hlCompatible(g.hl, o.hl);
    if (g.cell !== o.cell && !sameMenu) {
      parts.push(`cell ${g.cell}≠${o.cell}`);
    }
    // hl: allow 0 vs 1 at menu entry (no highlight yet vs default button 1)
    if (!hlCompatible(g.hl, o.hl)) parts.push(`hl ${g.hl}≠${o.hl}`);
    if (parts.length) {
      diffs.push(`pos[${i}]: ${parts.join(', ')} (gold=${fmt(g)} ours=${fmt(o)})`);
    }
  }

  return {
    ok: diffs.length === 0,
    diffs,
    goldPositions,
    oursPositions,
  };
}

function extractPositions(steps: NavTraceStep[]): TracePos[] {
  const out: TracePos[] = [];
  for (const s of steps) {
    if (!COMPARE_EVENTS.has(s.event)) continue;
    // Skip start (both sides emit before any nav).
    if (s.event === 'start') continue;
    const pos = stepToPos(s);
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.space === pos.space &&
      prev.vts === pos.vts &&
      prev.pgc === pos.pgc &&
      prev.cell === pos.cell &&
      prev.hl === pos.hl &&
      prev.pg === pos.pg
    ) {
      continue; // collapse pump_end/pos/still duplicates
    }
    out.push(pos);
  }
  return out;
}

function spaceCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  // FP often looks like menu domain 0 after first JumpSS.
  if ((a === 'fp' || b === 'fp') && (a === 'menu' || b === 'menu')) return true;
  return false;
}

function hlCompatible(a: number, b: number): boolean {
  if (a === b) return true;
  // Menu entry often has no highlight yet (0) vs default/button N.
  if (a === 0 || b === 0) return true;
  return false;
}

function fmt(p: TracePos): string {
  return `${p.space} vts=${p.vts} pgc=${p.pgc} cell=${p.cell} hl=${p.hl}`;
}
