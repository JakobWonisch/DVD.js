/** Disc-path nav trace (Part 3). Shared by libdvdnav play + vm.js replay. */

export type TraceSpace = 'fp' | 'menu' | 'title';

export type TraceEvent =
  | 'start'
  | 'end'
  | 'pos'
  | 'cell'
  | 'vts'
  | 'still'
  | 'wait'
  | 'stop'
  | 'highlight'
  | 'hop'
  | 'pump_end'
  | 'input_activate'
  | 'input_select'
  | 'input_select_button'
  | 'input_still_skip'
  | 'input_wait_skip'
  | 'input_menu'
  | string;

export type NavTraceStep = {
  i: number;
  event: TraceEvent;
  space: TraceSpace | string;
  domain?: string;
  vts: number;
  title?: number;
  pgc: number;
  pg: number;
  cell: number;
  hl: number;
  still?: number;
  button?: number;
  dir?: string;
  blocks?: number;
  hit?: boolean;
  menu?: string;
};

/** Comparable position (sector/block ignored). */
export type TracePos = {
  space: string;
  vts: number;
  pgc: number;
  pg: number;
  cell: number;
  hl: number;
};

export function stepToPos(step: NavTraceStep): TracePos {
  return {
    space: step.space,
    vts: step.vts | 0,
    pgc: step.pgc | 0,
    pg: step.pg | 0,
    cell: step.cell | 0,
    hl: step.hl | 0,
  };
}

/** Events that represent settled navigation state for diffs. */
export const COMPARE_EVENTS = new Set([
  'pos',
  'pump_end',
  'still',
  'stop',
  'end',
]);
