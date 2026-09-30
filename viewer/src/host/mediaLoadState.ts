/**
 * Bottom-left loading indicator state for the player stage.
 * Host code begins/ends waits; PlayDisc subscribes and renders the spinner.
 */

export type MediaLoadState = {
  active: boolean;
  /** 0..1 when known; null = indeterminate spinner. */
  progress: number | null;
  label: string;
  /** Generation so stale end() calls cannot clear a newer wait. */
  gen: number;
};

type Listener = (state: MediaLoadState) => void;

const IDLE: MediaLoadState = {
  active: false,
  progress: null,
  label: '',
  gen: 0,
};

let state: MediaLoadState = { ...IDLE };
let gen = 0;
const listeners = new Set<Listener>();

function emit(): void {
  for (const fn of listeners) {
    try {
      fn(state);
    } catch {
      // ignore subscriber errors
    }
  }
}

export function getMediaLoadState(): MediaLoadState {
  return state;
}

export function subscribeMediaLoad(fn: Listener): () => void {
  listeners.add(fn);
  fn(state);
  return () => {
    listeners.delete(fn);
  };
}

/** Start (or replace) a media wait. Returns a token for end/update. */
export function beginMediaLoad(label: string): number {
  gen += 1;
  state = {
    active: true,
    progress: null,
    label: label || 'Loading…',
    gen,
  };
  emit();
  return gen;
}

export function updateMediaLoadProgress(
  token: number,
  progress: number | null,
): void {
  if (token !== gen || !state.active) {
    return;
  }
  const p =
    progress == null || !Number.isFinite(progress)
      ? null
      : Math.max(0, Math.min(1, progress));
  if (p === state.progress) {
    return;
  }
  state = { ...state, progress: p };
  emit();
}

export function endMediaLoad(token: number): void {
  if (token !== gen) {
    return;
  }
  state = { ...IDLE, gen };
  emit();
}

/** Clear regardless of token (e.g. disc dispose). */
export function clearMediaLoad(): void {
  gen += 1;
  state = { ...IDLE, gen };
  emit();
}
