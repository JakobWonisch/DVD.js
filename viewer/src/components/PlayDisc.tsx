import {
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  Show,
  type Component,
} from 'solid-js';
import { useParams } from '@solidjs/router';
import { DvdDisc } from './DvdDisc.js';
import { VirtualRemote } from './VirtualRemote.js';
import { AUTOPLAY_BLOCKED_EVENT, pageHasUserGesture, unlockDvdAudio } from '../host/autoplay.js';
import {
  log,
  warn,
  isViewerDebug,
  setViewerDebug,
} from '../host/viewerDebug.js';
import {
  getSessionLogMeta,
  getSessionLogText,
  resetSessionLog,
} from '../host/sessionLog.js';
import {
  clearMediaLoad,
  subscribeMediaLoad,
  type MediaLoadState,
} from '../host/mediaLoadState.js';
import {
  CRT_STORAGE_KEY,
  VIRTUAL_REMOTE_STORAGE_KEY,
  VIRTUAL_REMOTE_STORAGE_KEY_LEGACY,
  readStoragePrefer,
  writeStorage,
} from '../projectId.js';
import { loadVm, startVm } from '../vm/loadVm.js';
import type { DiscMetadata } from '../types/metadata.js';
import { installViewerCrashGuard } from '../host/viewerCrash.js';
import {
  canVmUndo,
  pushVmUndo,
  VM_UNDO_CHANGE_EVENT,
} from '../host/vmUndo.js';

type PlayerHost = HTMLElement & {
  setDebugHitboxes?: (enabled: boolean) => void;
  skipToEnd?: () => boolean;
  goToMainMenu?: () => boolean;
  undoNav?: () => boolean;
  canUndoNav?: () => boolean;
  setMenuLanguage?: (lang: string) => boolean;
  _dvdjsOnReportProblem?: () => void | Promise<void>;
};

type EnsureStatus = 'ready' | 'decompressing' | 'missing';

async function ensureDiscReady(
  dvdId: string,
  onStatus?: (status: EnsureStatus) => void,
): Promise<EnsureStatus> {
  const pollMs = 400;
  const maxWaitMs = 30 * 60 * 1000;
  const started = Date.now();
  let lastLogged: EnsureStatus | null = null;
  let polls = 0;

  log('ensure', `start ${dvdId}`);

  while (Date.now() - started < maxWaitMs) {
    polls += 1;
    const res = await fetch(`/api/disc/${encodeURIComponent(dvdId)}/ensure`);
    if (res.status === 404) {
      warn('ensure', `${dvdId} → missing (404)`, {
        polls,
        ms: Date.now() - started,
      });
      onStatus?.('missing');
      return 'missing';
    }
    if (!res.ok) {
      warn('ensure', `${dvdId} HTTP ${res.status}`, {
        polls,
        ms: Date.now() - started,
      });
      throw new Error(`Could not prepare /${dvdId} (${res.status})`);
    }
    const body = (await res.json()) as {
      status?: EnsureStatus;
      error?: string;
    };
    const status: EnsureStatus =
      body.status === 'ready' ||
      body.status === 'decompressing' ||
      body.status === 'missing'
        ? body.status
        : 'missing';
    if (status !== lastLogged || polls === 1 || polls % 25 === 0) {
      log('ensure', `${dvdId} → ${status}`, {
        polls,
        ms: Date.now() - started,
        error: body.error || null,
      });
      lastLogged = status;
    }
    onStatus?.(status);
    if (status === 'ready' || status === 'missing') {
      return status;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  warn('ensure', `${dvdId} timed out`, {
    polls,
    ms: Date.now() - started,
  });
  throw new Error(`Timed out waiting for /${dvdId} to decompress`);
}

async function fetchMetadata(
  dvdId: string,
  onEnsureStatus?: (status: EnsureStatus) => void,
): Promise<DiscMetadata> {
  const status = await ensureDiscReady(dvdId, onEnsureStatus);
  if (status === 'missing') {
    throw new Error(`Disc “${dvdId}” was not found (no archive or folder).`);
  }
  log('meta', `fetch /${dvdId}/metadata.json`);
  const res = await fetch(`/${dvdId}/metadata.json`);
  if (!res.ok) {
    warn('meta', `/${dvdId}/metadata.json → ${res.status}`);
    throw new Error(`Could not load /${dvdId}/metadata.json (${res.status})`);
  }
  const json = (await res.json()) as DiscMetadata;
  log('meta', `loaded ${dvdId}`, {
    domains: Array.isArray(json) ? json.length : Object.keys(json || {}).length,
  });
  return json;
}

export const PlayDisc: Component = () => {
  const params = useParams<{ dvdId: string }>();
  const [decompressing, setDecompressing] = createSignal(false);
  const [metadata] = createResource(
    () => params.dvdId,
    (id) =>
      fetchMetadata(id, (status) => {
        setDecompressing(status === 'decompressing');
      }).finally(() => setDecompressing(false)),
  );
  const [hostEl, setHostEl] = createSignal<PlayerHost | null>(null);
  const [stageEl, setStageEl] = createSignal<HTMLElement | null>(null);
  const [vmError, setVmError] = createSignal<string | null>(null);
  const [vmReady, setVmReady] = createSignal(false);
  // Hard refresh: no gesture yet → Start overlay. Catalogue click: skip overlay.
  const [needsStart, setNeedsStart] = createSignal(!pageHasUserGesture());
  const [debugHitboxes, setDebugHitboxes] = createSignal(false);
  const [consoleDebug, setConsoleDebug] = createSignal(isViewerDebug());
  const [showRemote, setShowRemote] = createSignal(
    readStoragePrefer(
      VIRTUAL_REMOTE_STORAGE_KEY,
      VIRTUAL_REMOTE_STORAGE_KEY_LEGACY,
    ) === '1',
  );
  const [crtOn, setCrtOn] = createSignal(
    (() => {
      try {
        return localStorage.getItem(CRT_STORAGE_KEY) === '1';
      } catch {
        return false;
      }
    })(),
  );
  const [isFullscreen, setIsFullscreen] = createSignal(false);
  const [mediaLoad, setMediaLoad] = createSignal<MediaLoadState>({
    active: false,
    progress: null,
    label: '',
    gen: 0,
  });
  const [reportBusy, setReportBusy] = createSignal(false);
  const [reportMsg, setReportMsg] = createSignal<string | null>(null);
  const [undoAvailable, setUndoAvailable] = createSignal(false);

  const refreshUndoAvailable = () => {
    const host = hostEl();
    setUndoAvailable(
      !!(host && (host.canUndoNav?.() ?? canVmUndo(host as any))),
    );
  };

  createEffect(() => {
    const unsub = subscribeMediaLoad(setMediaLoad);
    onCleanup(unsub);
  });

  createEffect(() => {
    // Fresh ring buffer per disc visit.
    if (params.dvdId) {
      resetSessionLog();
      log('boot', 'session log reset', { dvdId: params.dvdId });
    }
  });

  createEffect(() => {
    if (consoleDebug()) {
      log('boot', 'console debug enabled', {
        dvdId: params.dvdId,
        href: typeof location !== 'undefined' ? location.href : null,
      });
    }
  });

  createEffect(() => {
    const id = params.dvdId;
    const meta = metadata();
    const host = hostEl();
    if (!id || !meta || !host) {
      return;
    }

    (host as any)._dvdjsMetadata = meta;

    let disposed = false;
    let disposeVm: (() => void) | undefined;

    setVmReady(false);
    const hadGesture = pageHasUserGesture();
    setNeedsStart(!hadGesture);

    log('vm', `loadVm ${id}`, { hadGesture });
    loadVm(id, host)
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        disposeVm = dispose;
        setVmReady(true);
        log('vm', `vm.js ready ${id}`, {
          gesture: pageHasUserGesture(),
        });
        // Prior click (e.g. catalogue → player): start immediately.
        if (pageHasUserGesture()) {
          unlockDvdAudio(host);
          setNeedsStart(false);
          log('vm', 'auto-start after gesture');
          startVm(host);
        } else {
          log('vm', 'waiting for Start disc overlay');
        }
      })
      .catch((e) => {
        if (!disposed) {
          const msg = e instanceof Error ? e.message : String(e);
          warn('vm', `loadVm failed: ${msg}`);
          setVmError(msg);
        }
      });

    const onBlocked = () => {
      warn('vm', 'autoplay blocked — showing Start overlay');
      setNeedsStart(true);
    };
    host.addEventListener(AUTOPLAY_BLOCKED_EVENT, onBlocked);

    onCleanup(() => {
      disposed = true;
      host.removeEventListener(AUTOPLAY_BLOCKED_EVENT, onBlocked);
      disposeVm?.();
      clearMediaLoad();
      setVmError(null);
      setVmReady(false);
      setNeedsStart(!pageHasUserGesture());
    });
  });

  createEffect(() => {
    const host = hostEl();
    const on = debugHitboxes();
    host?.setDebugHitboxes?.(on);
  });

  createEffect(() => {
    const stage = stageEl();
    if (!stage) {
      return;
    }
    const onFs = () => {
      setIsFullscreen(document.fullscreenElement === stage);
    };
    document.addEventListener('fullscreenchange', onFs);
    onCleanup(() => document.removeEventListener('fullscreenchange', onFs));
  });

  const toggleFullscreen = async () => {
    const stage = stageEl();
    if (!stage) {
      return;
    }
    try {
      if (document.fullscreenElement === stage) {
          await document.exitFullscreen();
        } else {
          await stage.requestFullscreen();
        }
    } catch (e) {
      console.warn('Fullscreen failed', e);
    }
  };

  const onStart = () => {
    const host = hostEl();
    if (!host || !vmReady()) {
      warn('vm', 'Start pressed but host/vm not ready', {
        hasHost: !!host,
        vmReady: vmReady(),
      });
      return;
    }
    unlockDvdAudio(host);
    setNeedsStart(false);
    log('vm', 'Start disc clicked');
    startVm(host);
  };

  const submitProblemReport = async (): Promise<void> => {
    if (reportBusy()) {
      throw new Error('Report already in progress.');
    }
    setReportBusy(true);
    setReportMsg(null);
    const meta = getSessionLogMeta();
    log('report', 'submitting session log', {
      entries: meta.entryCount,
      discId: params.dvdId,
    });
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discId: params.dvdId,
          href: typeof location !== 'undefined' ? location.href : null,
          userAgent:
            typeof navigator !== 'undefined' ? navigator.userAgent : null,
          sessionStartedAt: meta.startedAt,
          entryCount: meta.entryCount,
          log: getSessionLogText(),
        }),
      });
      let body: { ok?: boolean; error?: string; message?: string; id?: string } =
        {};
      try {
        body = (await res.json()) as typeof body;
      } catch {
        // ignore
      }
      if (res.status === 507 || body.error === 'storage_full') {
        const msg = 'Report storage is full — try again later.';
        setReportMsg(msg);
        warn('report', 'storage full');
        throw new Error(msg);
      }
      if (res.status === 429 || body.error === 'rate_limited') {
        const msg = 'Too many reports — try again later.';
        setReportMsg(msg);
        warn('report', 'rate limited');
        throw new Error(msg);
      }
      if (!res.ok || !body.ok) {
        const msg = body.message || 'Could not send report.';
        setReportMsg(msg);
        warn('report', 'failed', { status: res.status, body });
        throw new Error(msg);
      }
      setReportMsg('Thanks — report sent.');
      log('report', 'accepted', { id: body.id ?? null });
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : 'Could not send report.';
      if (!reportMsg()) {
        setReportMsg('Could not send report.');
        warn('report', 'network error', { error: msg });
      }
      throw e instanceof Error ? e : new Error(msg);
    } finally {
      setReportBusy(false);
    }
  };

  const onReportProblem = () => {
    void submitProblemReport().catch(() => {
      // status already set
    });
  };

  createEffect(() => {
    const host = hostEl();
    if (!host) {
      return;
    }
    host._dvdjsOnReportProblem = () => submitProblemReport();
    const disposeGuard = installViewerCrashGuard({
      getHost: () => hostEl() as any,
      isActive: () =>
        !!(vmReady() && metadata() && !needsStart() && !decompressing()),
      onReport: () => submitProblemReport(),
    });
    // Menu click/keydown handlers call stopImmediatePropagation after activate,
    // so bubbling polls never see the push — listen for the stack change event.
    const onUndoChange = () => refreshUndoAvailable();
    host.addEventListener(VM_UNDO_CHANGE_EVENT, onUndoChange);
    (host as any)._dvdjsOnUndoChange = onUndoChange;
    refreshUndoAvailable();
    onCleanup(() => {
      disposeGuard();
      host.removeEventListener(VM_UNDO_CHANGE_EVENT, onUndoChange);
      if ((host as any)._dvdjsOnUndoChange === onUndoChange) {
        delete (host as any)._dvdjsOnUndoChange;
      }
      if (host._dvdjsOnReportProblem) {
        delete host._dvdjsOnReportProblem;
      }
    });
  });

  /** Hard lock: start overlay / decompress — all toolbar controls inert. */
  const controlsLocked = () =>
    !!(
      (needsStart() && vmReady() && metadata()) ||
      (decompressing() && metadata.loading) ||
      (metadata.loading && !decompressing())
    );

  /** Soft lock: media wait — keep Skip / Main menu as escapes. */
  const mediaWaitActive = () => mediaLoad().active;

  const toolbarNonEscapeLocked = () => controlsLocked() || mediaWaitActive();

  return (
    <div class="player-stage" ref={setStageEl}>
      <div class="player-surface">
        <Show when={decompressing() && metadata.loading}>
          <div class="decompress-screen" role="status" aria-live="polite">
            <p class="decompress-screen__title">Decompressing…</p>
            <p class="decompress-screen__hint">
              Preparing this disc’s menus. Playback starts when ready.
            </p>
          </div>
        </Show>
        <Show when={metadata.loading && !decompressing()}>
          <div class="player-surface__status muted" role="status">
            Loading disc…
          </div>
        </Show>
        <Show when={metadata.error}>
          <div class="player-surface__status error">
            {metadata.error instanceof Error
              ? metadata.error.message
              : String(metadata.error)}
          </div>
        </Show>
        <Show when={vmError()}>
          <div class="player-surface__status error">{vmError()}</div>
        </Show>
        <Show when={metadata()}>
          {(meta) => (
            <crt-effect
              class="player-surface__crt"
              attr:preset="minimal"
              attr:fill=""
              attr:enabled={crtOn() ? 'true' : 'false'}
              attr:enable-glow=""
              attr:enable-glare=""
              attr:enable-curvature=""
            >
              <DvdDisc metadata={meta()} hostRef={setHostEl} />
            </crt-effect>
          )}
        </Show>
        <Show when={needsStart() && vmReady() && metadata()}>
          <div class="dvd-menu-archive-start-overlay">
            <button
              type="button"
              class="dvd-menu-archive-start-overlay__btn"
              onClick={onStart}
            >
              Start disc
            </button>
            <p class="dvd-menu-archive-start-overlay__hint">
              Browsers block video until you interact — press to play the intro.
            </p>
          </div>
        </Show>
        <Show when={mediaLoad().active}>
          <div
            class="player-media-load"
            role="status"
            aria-live="polite"
            aria-busy="true"
            title={mediaLoad().label || 'Loading…'}
          >
            <span class="player-media-load__spinner" aria-hidden="true" />
            <Show
              when={
                mediaLoad().progress != null &&
                Number.isFinite(mediaLoad().progress as number)
              }
            >
              <span class="player-media-load__pct">
                {Math.round((mediaLoad().progress as number) * 100)}%
              </span>
            </Show>
          </div>
        </Show>
      </div>
      <Show when={metadata() && showRemote() && !needsStart()}>
        <VirtualRemote host={hostEl()} />
      </Show>
      <Show when={metadata()}>
        <div
          class="player-toolbar"
          classList={{
            'player-toolbar--locked': controlsLocked(),
            'player-toolbar--media-wait': mediaWaitActive() && !controlsLocked(),
          }}
          aria-disabled={controlsLocked() ? 'true' : undefined}
        >
          <div class="player-toolbar__toggles">
            <label class="player-toolbar__debug">
              <input
                type="checkbox"
                checked={debugHitboxes()}
                disabled={toolbarNonEscapeLocked()}
                onChange={(e) => setDebugHitboxes(e.currentTarget.checked)}
              />
              Debug button hitboxes
            </label>
            <label class="player-toolbar__debug">
              <input
                type="checkbox"
                checked={consoleDebug()}
                disabled={toolbarNonEscapeLocked()}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  setConsoleDebug(on);
                  setViewerDebug(on);
                  if (on) {
                    log('boot', 'console debug turned on from toolbar');
                  }
                }}
              />
              Console debug
            </label>
            <label class="player-toolbar__debug">
              <input
                type="checkbox"
                checked={showRemote()}
                disabled={toolbarNonEscapeLocked()}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  setShowRemote(on);
                  writeStorage(VIRTUAL_REMOTE_STORAGE_KEY, on ? '1' : '0');
                }}
              />
              Virtual remote
            </label>
            <label class="player-toolbar__debug">
              <input
                type="checkbox"
                checked={crtOn()}
                disabled={toolbarNonEscapeLocked()}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  setCrtOn(on);
                  writeStorage(CRT_STORAGE_KEY, on ? '1' : '0');
                }}
              />
              CRT filter
            </label>
          </div>
          <div class="player-toolbar__actions">
            <button
              type="button"
              class="player-toolbar__report"
              title="Send this session’s diagnostic log to the server"
              disabled={toolbarNonEscapeLocked() || reportBusy()}
              onClick={() => void onReportProblem()}
            >
              {reportBusy() ? 'Sending…' : 'Report a problem'}
            </button>
            <Show when={reportMsg()}>
              <span class="player-toolbar__report-msg" role="status">
                {reportMsg()}
              </span>
            </Show>
            <button
              type="button"
              class="player-toolbar__undo"
              title="Undo last menu navigation (Ctrl+Z)"
              disabled={controlsLocked() || !undoAvailable()}
              onClick={() => {
                hostEl()?.undoNav?.();
                refreshUndoAvailable();
              }}
            >
              Undo
            </button>
            <button
              type="button"
              class="player-toolbar__skip"
              title="Skip to end of current clip (N)"
              disabled={controlsLocked()}
              onClick={() => hostEl()?.skipToEnd?.()}
            >
              Skip to end
            </button>
            <button
              type="button"
              class="player-toolbar__menu"
              title="Jump to title/root menu (M)"
              disabled={controlsLocked()}
              onClick={() => {
                const host = hostEl();
                if (!host) {
                  return;
                }
                try {
                  pushVmUndo(host as any, window as any);
                } catch {
                  // ignore
                }
                host.goToMainMenu?.();
                refreshUndoAvailable();
              }}
            >
              Main menu
            </button>
            <button
              type="button"
              class="player-toolbar__fs"
              disabled={toolbarNonEscapeLocked()}
              onClick={() => void toggleFullscreen()}
            >
              {isFullscreen() ? 'Exit fullscreen' : 'Fullscreen'}
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
};
