import {
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  type Component,
  type ParentProps,
} from 'solid-js';
import { A, useLocation, useNavigate, useParams } from '@solidjs/router';
import { Catalogue, fetchDvdList } from './Catalogue.js';

const MOBILE_MQ = '(max-width: 860px)';

function useIsMobile(): () => boolean {
  const [mobile, setMobile] = createSignal(
    typeof window !== 'undefined'
      ? window.matchMedia(MOBILE_MQ).matches
      : false,
  );
  createEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    onCleanup(() => mq.removeEventListener('change', onChange));
  });
  return mobile;
}

export const ViewerEmpty: Component = () => (
  <div class="viewer-empty" role="status">
    <p class="viewer-empty__title">No disc selected</p>
    <p class="viewer-empty__hint">
      Open a case from the stack, then click again to play its menus here.
    </p>
  </div>
);

/**
 * Archive home: spine catalogue + embedded player.
 * Desktop: player sits to the right. Mobile: bottom drawer.
 * `children` is the nested route outlet (PlayDisc or ViewerEmpty).
 */
export const ArchivePage: Component<ParentProps> = (props) => {
  const params = useParams<{ dvdId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [dvds] = createResource(fetchDvdList);

  const dvdId = createMemo(() => {
    if (params.dvdId) {
      return params.dvdId;
    }
    const m = location.pathname.match(/^\/play\/([^/]+)\/?$/);
    return m ? decodeURIComponent(m[1]) : undefined;
  });

  const discTitle = createMemo(() => {
    const id = dvdId();
    if (!id) {
      return undefined;
    }
    const hit = dvds()?.find((d) => d.dir === id);
    return hit?.name ?? id;
  });

  const hasDisc = () => Boolean(dvdId());
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [shareToast, setShareToast] = createSignal<string | null>(null);
  let shareToastTimer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    if (dvdId()) {
      setDrawerOpen(true);
    } else {
      setDrawerOpen(false);
    }
  });

  createEffect(() => {
    if (!(drawerOpen() && isMobile())) {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    onCleanup(() => {
      document.body.style.overflow = prev;
    });
  });

  onCleanup(() => {
    if (shareToastTimer !== undefined) {
      clearTimeout(shareToastTimer);
    }
  });

  const showShareCopiedToast = () => {
    setShareToast('Link copied to clipboard');
    if (shareToastTimer !== undefined) {
      clearTimeout(shareToastTimer);
    }
    shareToastTimer = setTimeout(() => {
      setShareToast(null);
      shareToastTimer = undefined;
    }, 2200);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  const dismissDisc = () => {
    setDrawerOpen(false);
    if (hasDisc()) {
      navigate('/');
    }
  };

  const openDrawer = () => {
    if (hasDisc()) {
      setDrawerOpen(true);
    }
  };

  const shareDisc = async () => {
    const id = dvdId();
    const title = discTitle();
    if (!id || !title) {
      return;
    }
    const link = `${window.location.origin}/play/${encodeURIComponent(id)}`;
    const shareTitle = `View the menu of "${title}"`;
    const text = `${shareTitle} at ${link}`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: shareTitle, text: shareTitle, url: link });
        return;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      showShareCopiedToast();
    } catch {
      // Share/clipboard unavailable — nothing else to do.
    }
  };

  const catalogueError = () => {
    const err = dvds.error;
    if (!err) {
      return null;
    }
    return err instanceof Error ? err.message : String(err);
  };

  return (
    <div
      class="archive-layout"
      classList={{
        'archive-layout--playing': hasDisc(),
        'archive-layout--drawer-open': drawerOpen() && isMobile(),
      }}
    >
      <Show when={shareToast()}>
        {(msg) => (
          <div class="share-toast" role="status" aria-live="polite">
            {msg()}
          </div>
        )}
      </Show>
      <div class="archive-layout__catalogue">
        <Catalogue
          selectedDir={dvdId()}
          dvds={dvds()}
          loading={dvds.loading}
          error={catalogueError()}
        />
      </div>

      <Show when={isMobile() && hasDisc() && !drawerOpen()}>
        <button
          type="button"
          class="viewer-peek"
          onClick={openDrawer}
          aria-expanded="false"
          aria-controls="archive-viewer"
        >
          <span class="viewer-peek__label">Resume {discTitle()}</span>
          <span class="viewer-peek__chevron" aria-hidden="true">
            ▲
          </span>
        </button>
      </Show>

      <Show when={isMobile() && hasDisc()}>
        <button
          type="button"
          class="viewer-backdrop"
          classList={{ 'viewer-backdrop--open': drawerOpen() }}
          aria-label="Collapse player"
          aria-hidden={!drawerOpen() ? 'true' : undefined}
          tabIndex={drawerOpen() ? 0 : -1}
          onClick={closeDrawer}
        />
      </Show>

      <aside
        id="archive-viewer"
        class="archive-layout__viewer"
        classList={{
          'archive-layout__viewer--open': !isMobile() || drawerOpen(),
          'archive-layout__viewer--empty': !hasDisc(),
        }}
        aria-hidden={isMobile() && !drawerOpen() ? 'true' : undefined}
      >
        <div class="viewer-chrome">
          <div class="viewer-chrome__bar">
            <div class="viewer-chrome__heading">
              <Show
                when={isMobile() && hasDisc()}
                fallback={
                  <div class="viewer-chrome__title">
                    <Show when={hasDisc()} fallback={<span>Player</span>}>
                      <span class="viewer-chrome__disc">{discTitle()}</span>
                    </Show>
                  </div>
                }
              >
                <button
                  type="button"
                  class="viewer-chrome__title viewer-chrome__title--collapse"
                  onClick={closeDrawer}
                  aria-label="Collapse player"
                >
                  <span class="viewer-chrome__disc">{discTitle()}</span>
                </button>
              </Show>
              <Show when={hasDisc()}>
                <div class="viewer-chrome__actions">
                  <A
                    href="/"
                    class="viewer-chrome__eject"
                    onClick={(e) => {
                      e.preventDefault();
                      dismissDisc();
                    }}
                  >
                    Eject
                  </A>
                  <button
                    type="button"
                    class="viewer-chrome__share"
                    onClick={() => {
                      void shareDisc();
                    }}
                  >
                    Share
                  </button>
                </div>
              </Show>
            </div>
            <Show when={isMobile()}>
              <button
                type="button"
                class="viewer-chrome__dismiss"
                aria-label="Collapse player"
                onClick={closeDrawer}
              >
                <span class="viewer-chrome__dismiss-chevron" aria-hidden="true">
                  ▼
                </span>
              </button>
            </Show>
          </div>
          <div class="viewer-chrome__body">{props.children}</div>
        </div>
      </aside>
    </div>
  );
};
