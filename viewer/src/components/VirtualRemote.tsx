import {
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import {
  handleMenuNavAction,
  type MenuKeyHost,
  type MenuNavAction,
} from '../host/menuKeys.js';
import {
  VIRTUAL_REMOTE_POS_STORAGE_KEY,
  writeStorage,
} from '../projectId.js';

type Props = {
  host: MenuKeyHost | null | undefined;
};

type Orientation = 'portrait' | 'landscape';

type RemotePos = {
  left: number;
  top: number;
};

type PosStore = Partial<Record<Orientation, RemotePos>>;

const ACTIONS: { action: MenuNavAction; label: string; className: string }[] = [
  { action: 'up', label: 'Up', className: 'virtual-remote__btn--up' },
  { action: 'left', label: 'Left', className: 'virtual-remote__btn--left' },
  { action: 'enter', label: 'Enter', className: 'virtual-remote__btn--enter' },
  { action: 'right', label: 'Right', className: 'virtual-remote__btn--right' },
  { action: 'down', label: 'Down', className: 'virtual-remote__btn--down' },
];

const EDGE_MARGIN_PX = 20;
const FULLSCREEN_TOOLBAR_CLEARANCE_PX = 64;

function glyph(action: MenuNavAction): string {
  switch (action) {
    case 'up':
      return '▲';
    case 'down':
      return '▼';
    case 'left':
      return '◀';
    case 'right':
      return '▶';
    case 'enter':
      return '●';
  }
}

function currentOrientation(): Orientation {
  return window.matchMedia('(orientation: portrait)').matches
    ? 'portrait'
    : 'landscape';
}

function readPosStore(): PosStore {
  try {
    const raw = localStorage.getItem(VIRTUAL_REMOTE_POS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as PosStore;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return sanitizeStore(parsed);
  } catch {
    return {};
  }
}

function sanitizeStore(store: PosStore): PosStore {
  const out: PosStore = {};
  for (const key of ['portrait', 'landscape'] as const) {
    const pos = store[key];
    if (
      pos &&
      typeof pos.left === 'number' &&
      typeof pos.top === 'number' &&
      Number.isFinite(pos.left) &&
      Number.isFinite(pos.top)
    ) {
      out[key] = { left: pos.left, top: pos.top };
    }
  }
  return out;
}

function writePosStore(store: PosStore): void {
  writeStorage(VIRTUAL_REMOTE_POS_STORAGE_KEY, JSON.stringify(store));
}

type FixedCb = {
  /** Element that is the fixed containing block, or null for the viewport. */
  el: HTMLElement | null;
  width: number;
  height: number;
  /** Client-rect origin — subtract from pointer clientX/Y for CB-local coords. */
  originLeft: number;
  originTop: number;
};

/**
 * `position:fixed` is viewport-relative unless an ancestor has transform /
 * filter / perspective / contain (mobile drawer uses transform: translateY).
 * Clamping must use that box — window.innerHeight places the remote below the
 * drawer, where overflow:hidden clips it away.
 */
function fixedContainingBlock(from: HTMLElement): FixedCb {
  const fs = document.fullscreenElement;
  if (fs instanceof HTMLElement && fs.contains(from)) {
    const r = fs.getBoundingClientRect();
    return {
      el: fs,
      width: fs.clientWidth,
      height: fs.clientHeight,
      originLeft: r.left,
      originTop: r.top,
    };
  }

  let node: HTMLElement | null = from.parentElement;
  while (node && node !== document.documentElement) {
    const style = getComputedStyle(node);
    const indiv =
      (style.translate && style.translate !== 'none') ||
      (style.scale && style.scale !== 'none') ||
      (style.rotate && style.rotate !== 'none');
    const transformed =
      (style.transform && style.transform !== 'none') ||
      indiv ||
      (style.filter !== 'none' && style.filter !== '') ||
      (style.perspective && style.perspective !== 'none') ||
      style.contain.includes('paint') ||
      style.contain.includes('layout') ||
      style.willChange.split(',').some((p) => {
        const t = p.trim();
        return t === 'transform' || t === 'filter' || t === 'perspective';
      });
    if (transformed) {
      const r = node.getBoundingClientRect();
      return {
        el: node,
        width: node.clientWidth,
        height: node.clientHeight,
        originLeft: r.left,
        originTop: r.top,
      };
    }
    node = node.parentElement;
  }

  const vv = window.visualViewport;
  return {
    el: null,
    width: vv?.width ?? window.innerWidth,
    height: vv?.height ?? window.innerHeight,
    originLeft: vv?.offsetLeft ?? 0,
    originTop: vv?.offsetTop ?? 0,
  };
}

function stageRoot(el: HTMLElement | null): HTMLElement | null {
  return el?.closest('.player-stage') as HTMLElement | null;
}

function isStageFullscreen(stage: HTMLElement | null): boolean {
  const fs = document.fullscreenElement;
  return !!(fs && stage && (fs === stage || fs.contains(stage)));
}

function edgeInsets(stage: HTMLElement | null): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const bottom = isStageFullscreen(stage)
    ? FULLSCREEN_TOOLBAR_CLEARANCE_PX
    : EDGE_MARGIN_PX;
  return {
    top: EDGE_MARGIN_PX,
    right: EDGE_MARGIN_PX,
    bottom,
    left: EDGE_MARGIN_PX,
  };
}

function defaultPos(
  width: number,
  height: number,
  cb: FixedCb,
  stage: HTMLElement | null,
): RemotePos {
  const inset = edgeInsets(stage);
  return {
    left: Math.max(inset.left, cb.width - width - inset.right),
    top: Math.max(inset.top, cb.height - height - inset.bottom),
  };
}

function clampPos(
  pos: RemotePos,
  width: number,
  height: number,
  cb: FixedCb,
  stage: HTMLElement | null,
): RemotePos {
  const inset = edgeInsets(stage);
  const maxLeft = Math.max(inset.left, cb.width - width - inset.right);
  const maxTop = Math.max(inset.top, cb.height - height - inset.bottom);
  return {
    left: Math.min(Math.max(pos.left, inset.left), maxLeft),
    top: Math.min(Math.max(pos.top, inset.top), maxTop),
  };
}

export const VirtualRemote: Component<Props> = (props) => {
  let rootEl: HTMLDivElement | undefined;
  const [pos, setPos] = createSignal<RemotePos | null>(null);
  const [dragging, setDragging] = createSignal(false);

  /** Preferred (stored or default) — clamp only for display, never write-back. */
  let store: PosStore = readPosStore();
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragPointerId: number | null = null;
  let dragMoved = false;
  let dragStartPos: RemotePos | null = null;

  const preferredFor = (
    orient: Orientation,
    w: number,
    h: number,
    cb: FixedCb,
    stage: HTMLElement | null,
  ): RemotePos => store[orient] ?? defaultPos(w, h, cb, stage);

  const applyDisplay = () => {
    const el = rootEl;
    if (!el) {
      return;
    }
    const stage = stageRoot(el);
    const cb = fixedContainingBlock(el);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w <= 0 || h <= 0 || cb.width <= 0 || cb.height <= 0) {
      return;
    }
    const preferred = preferredFor(currentOrientation(), w, h, cb, stage);
    setPos(clampPos(preferred, w, h, cb, stage));
  };

  const persistDragged = (next: RemotePos) => {
    const orient = currentOrientation();
    store = { ...store, [orient]: next };
    writePosStore(store);
  };

  const onGripPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const el = rootEl;
    if (!el) {
      return;
    }
    const cb = fixedContainingBlock(el);
    const rect = el.getBoundingClientRect();
    const originX = rect.left - cb.originLeft;
    const originY = rect.top - cb.originTop;
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    dragPointerId = e.pointerId;
    dragMoved = false;
    dragStartPos = { left: originX, top: originY };
    setDragging(true);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const onGripPointerMove = (e: PointerEvent) => {
    if (dragPointerId !== e.pointerId || !dragging()) {
      return;
    }
    e.preventDefault();
    const el = rootEl;
    if (!el) {
      return;
    }
    const stage = stageRoot(el);
    const cb = fixedContainingBlock(el);
    const next = clampPos(
      {
        left: e.clientX - cb.originLeft - dragOffsetX,
        top: e.clientY - cb.originTop - dragOffsetY,
      },
      el.offsetWidth,
      el.offsetHeight,
      cb,
      stage,
    );
    if (
      !dragMoved &&
      dragStartPos &&
      (Math.abs(next.left - dragStartPos.left) > 2 ||
        Math.abs(next.top - dragStartPos.top) > 2)
    ) {
      dragMoved = true;
    }
    setPos(next);
  };

  const endDrag = (e: PointerEvent) => {
    if (dragPointerId !== e.pointerId) {
      return;
    }
    dragPointerId = null;
    if (!dragging()) {
      return;
    }
    setDragging(false);
    const current = pos();
    // Only persist after a real move — a tap on a clamped display must not
    // overwrite the stored preferred position for a larger viewport.
    if (current && dragMoved) {
      persistDragged(current);
    }
    dragMoved = false;
    dragStartPos = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const press = (action: MenuNavAction, event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    const host = props.host;
    if (!host) {
      return;
    }
    handleMenuNavAction(host, action);
  };

  onMount(() => {
    applyDisplay();
    // Second frame: fonts/layout may still settle pad size / drawer open.
    requestAnimationFrame(() => applyDisplay());

    const onResize = () => {
      if (dragging()) {
        return;
      }
      applyDisplay();
    };
    const onOrient = () => {
      // Orientation flip: load that orientation's stored preferred pos (or default).
      applyDisplay();
    };
    const onFs = () => applyDisplay();

    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onOrient);
    document.addEventListener('fullscreenchange', onFs);
    window.visualViewport?.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('scroll', onResize);

    // Drawer height / transform CB changes without a window resize.
    let ro: ResizeObserver | null = null;
    const el = rootEl;
    if (el && typeof ResizeObserver !== 'undefined') {
      const cbEl = fixedContainingBlock(el).el;
      if (cbEl) {
        ro = new ResizeObserver(() => onResize());
        ro.observe(cbEl);
      }
    }

    onCleanup(() => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onOrient);
      document.removeEventListener('fullscreenchange', onFs);
      window.visualViewport?.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('scroll', onResize);
      ro?.disconnect();
    });
  });

  return (
    <div
      ref={(el) => {
        rootEl = el;
      }}
      class="virtual-remote"
      classList={{ 'virtual-remote--dragging': dragging() }}
      role="group"
      aria-label="Virtual remote"
      style={
        pos()
          ? {
              left: `${pos()!.left}px`,
              top: `${pos()!.top}px`,
              right: 'auto',
              bottom: 'auto',
              transform: 'none',
            }
          : undefined
      }
      onContextMenu={(e) => e.preventDefault()}
    >
      <div class="virtual-remote__pad">
        {ACTIONS.map(({ action, label, className }) => (
          <button
            type="button"
            class={`virtual-remote__btn ${className}`}
            aria-label={label}
            onPointerDown={(e) => {
              // Fire on press (not click) so touch feels immediate; ignore
              // secondary buttons / multi-touch duplicates.
              if (e.button !== 0) {
                return;
              }
              press(action, e);
            }}
          >
            <span aria-hidden="true">{glyph(action)}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        class="virtual-remote__grip"
        aria-label="Move virtual remote"
        title="Drag to move"
        onPointerDown={onGripPointerDown}
        onPointerMove={onGripPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span class="virtual-remote__grip-icon" aria-hidden="true">
          <span /><span /><span /><span />
          <span /><span /><span /><span />
        </span>
      </button>
    </div>
  );
};
