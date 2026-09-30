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
  VIRTUAL_REMOTE_STORAGE_KEY,
  VIRTUAL_REMOTE_STORAGE_KEY_LEGACY,
  readStoragePrefer,
  writeStorage,
} from '../projectId.js';
import { loadVm, startVm } from '../vm/loadVm.js';
import type { DiscMetadata } from '../types/metadata.js';

type PlayerHost = HTMLElement & {
  setDebugHitboxes?: (enabled: boolean) => void;
  skipToEnd?: () => boolean;
  goToMainMenu?: () => boolean;
  setMenuLanguage?: (lang: string) => boolean;
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
  const [isFullscreen, setIsFullscreen] = createSignal(false);

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

  return (
    <div class="player-stage" ref={setStageEl}>
      <Show when={decompressing() && metadata.loading}>
        <div class="decompress-screen" role="status" aria-live="polite">
          <p class="decompress-screen__title">Decompressing…</p>
          <p class="decompress-screen__hint">
            Preparing this disc’s menus. Playback starts when ready.
          </p>
        </div>
      </Show>
      <Show when={metadata.loading && !decompressing()}>
        <p class="muted">Loading disc…</p>
      </Show>
      <Show when={metadata.error}>
        <p class="error">
          {metadata.error instanceof Error
            ? metadata.error.message
            : String(metadata.error)}
        </p>
      </Show>
      <Show when={vmError()}>
        <p class="error">{vmError()}</p>
      </Show>
      <Show when={metadata()}>
        {(meta) => <DvdDisc metadata={meta()} hostRef={setHostEl} />}
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
      <Show when={metadata() && showRemote()}>
        <VirtualRemote host={hostEl()} />
      </Show>
      <Show when={metadata()}>
        <div class="player-toolbar">
          <div class="player-toolbar__toggles">
            <label class="player-toolbar__debug">
              <input
                type="checkbox"
                checked={debugHitboxes()}
                onChange={(e) => setDebugHitboxes(e.currentTarget.checked)}
              />
              Debug button hitboxes
            </label>
            <label class="player-toolbar__debug">
              <input
                type="checkbox"
                checked={consoleDebug()}
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
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  setShowRemote(on);
                  writeStorage(VIRTUAL_REMOTE_STORAGE_KEY, on ? '1' : '0');
                }}
              />
              Virtual remote
            </label>
          </div>
          <div class="player-toolbar__actions">
            <button
              type="button"
              class="player-toolbar__skip"
              title="Skip to end of current clip (N)"
              onClick={() => hostEl()?.skipToEnd?.()}
            >
              Skip to end
            </button>
            <button
              type="button"
              class="player-toolbar__menu"
              title="Jump to title/root menu (M)"
              onClick={() => hostEl()?.goToMainMenu?.()}
            >
              Main menu
            </button>
            <button
              type="button"
              class="player-toolbar__fs"
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
