import {
  For,
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
import { loadVm, startVm } from '../vm/loadVm.js';
import type { DiscMetadata } from '../types/metadata.js';
import {
  currentOrDefaultMenuLang,
  listDiscMenuLanguages,
  menuLangLabel,
  normalizeMenuLangCode,
  packMenuLangSprm,
  setDiscMenuLanguage,
  setStoredMenuLang,
} from '../host/menuLanguage.js';

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

  while (Date.now() - started < maxWaitMs) {
    const res = await fetch(`/api/disc/${encodeURIComponent(dvdId)}/ensure`);
    if (res.status === 404) {
      onStatus?.('missing');
      return 'missing';
    }
    if (!res.ok) {
      throw new Error(`Could not prepare /${dvdId} (${res.status})`);
    }
    const body = (await res.json()) as { status?: EnsureStatus };
    const status: EnsureStatus =
      body.status === 'ready' ||
      body.status === 'decompressing' ||
      body.status === 'missing'
        ? body.status
        : 'missing';
    onStatus?.(status);
    if (status === 'ready' || status === 'missing') {
      return status;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
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
  const res = await fetch(`/${dvdId}/metadata.json`);
  if (!res.ok) {
    throw new Error(`Could not load /${dvdId}/metadata.json (${res.status})`);
  }
  return res.json();
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
  const [showRemote, setShowRemote] = createSignal(
    typeof localStorage !== 'undefined' &&
      localStorage.getItem('dvdjs-virtual-remote') === '1',
  );
  const [isFullscreen, setIsFullscreen] = createSignal(false);
  const [menuLang, setMenuLang] = createSignal('en');

  createEffect(() => {
    const id = params.dvdId;
    const meta = metadata();
    const host = hostEl();
    if (!id || !meta || !host) {
      return;
    }

    let disposed = false;
    let disposeVm: (() => void) | undefined;

    setVmReady(false);
    const hadGesture = pageHasUserGesture();
    setNeedsStart(!hadGesture);

    loadVm(id, host)
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        disposeVm = dispose;
        setVmReady(true);
        // Prior click (e.g. catalogue → player): start immediately.
        if (pageHasUserGesture()) {
          unlockDvdAudio(host);
          setNeedsStart(false);
          startVm(host);
        }
      })
      .catch((e) => {
        if (!disposed) {
          setVmError(e instanceof Error ? e.message : String(e));
        }
      });

    const onBlocked = () => setNeedsStart(true);
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
    const meta = metadata();
    if (!meta) return;
    // Re-resolve when VM becomes ready so g.lang wins after init.
    void vmReady();
    setMenuLang(currentOrDefaultMenuLang(meta));
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
      return;
    }
    unlockDvdAudio(host);
    setNeedsStart(false);
    startVm(host);
  };

  const menuLanguages = () => {
    const meta = metadata();
    return meta ? listDiscMenuLanguages(meta) : [];
  };

  const onLanguageChange = (lang: string) => {
    const host = hostEl();
    const code = normalizeMenuLangCode(lang.trim().toLowerCase());
    if (!code) return;
    setMenuLang(code);
    setStoredMenuLang(code);
    const g = window as any;
    if (g && typeof g === 'object') {
      g.lang = code;
      if (g.sprm && typeof g.sprm === 'object') {
        g.sprm.MENU_LANG = packMenuLangSprm(code);
      }
    }
    // Before Start, only seed preference/lang — do not jump into menus.
    if (!host || !vmReady() || needsStart()) {
      return;
    }
    if (typeof host.setMenuLanguage === 'function') {
      host.setMenuLanguage(code);
    } else {
      setDiscMenuLanguage(host, code);
    }
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
        <div class="dvdjs-start-overlay">
          <button
            type="button"
            class="dvdjs-start-overlay__btn"
            onClick={onStart}
          >
            Start disc
          </button>
          <p class="dvdjs-start-overlay__hint">
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
            <Show when={menuLanguages().length > 1}>
              <label class="player-toolbar__lang">
                <span class="player-toolbar__lang-label">Menu language</span>
                <select
                  class="player-toolbar__lang-select"
                  value={menuLang()}
                  onChange={(e) => onLanguageChange(e.currentTarget.value)}
                >
                  <For each={menuLanguages()}>
                    {(lang) => (
                      <option value={lang}>{menuLangLabel(lang)}</option>
                    )}
                  </For>
                </select>
              </label>
            </Show>
            <label class="player-toolbar__debug">
              <input
                type="checkbox"
                checked={showRemote()}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  setShowRemote(on);
                  try {
                    localStorage.setItem(
                      'dvdjs-virtual-remote',
                      on ? '1' : '0',
                    );
                  } catch {
                    /* private mode / quota */
                  }
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
