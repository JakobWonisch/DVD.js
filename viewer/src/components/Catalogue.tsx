import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type Component,
  type JSX,
} from 'solid-js';
import { A } from '@solidjs/router';
import type { DvdListItem } from '../types/metadata.js';

export async function fetchDvdList(): Promise<DvdListItem[]> {
  const res = await fetch('/dvds.json');
  if (!res.ok) {
    throw new Error(
      `Could not load /dvds.json (${res.status}). Is webFolder configured and convert finished?`,
    );
  }
  const data = (await res.json()) as DvdListItem[];
  return [...data].sort((a, b) =>
    a.name > b.name ? 1 : a.name < b.name ? -1 : 0,
  );
}

function artUrl(dvd: DvdListItem): string {
  if (dvd.poster) {
    return '/' + dvd.poster;
  }
  return '/' + (dvd.cover || dvd.dir + '/cover.jpg');
}

function PlayIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M8 5.14v13.72L19 12 8 5.14z" />
    </svg>
  );
}

function CloseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.58 7.1 5.7a1 1 0 0 0-1.4 1.42L10.58 12 5.7 16.9a1 1 0 1 0 1.42 1.4L12 13.42l4.9 4.88a1 1 0 0 0 1.4-1.4L13.42 12l4.88-4.9a1 1 0 0 0 0-1.4z"
      />
    </svg>
  );
}

/**
 * Measure scene width in px. Avoid container-type / overflow:hidden on 3D
 * ancestors — both flatten preserve-3d.
 *
 * Clicks go through a scene-sized hit link: the 3D case box is much larger than
 * the visible spine strip, so its untransformed hit area would steal clicks.
 */
function DvdCaseScene(props: {
  open: boolean;
  href: string;
  name: string;
  art: string;
  onActivate: (e: MouseEvent) => void;
  onClose: (e: MouseEvent) => void;
}): JSX.Element {
  let sceneEl!: HTMLDivElement;

  onMount(() => {
    const sync = () => {
      const w = sceneEl.clientWidth;
      if (w <= 0) return;
      sceneEl.style.setProperty('--scene-w', `${w}px`);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(sceneEl);
    requestAnimationFrame(sync);
    onCleanup(() => ro.disconnect());
  });

  return (
    <div
      class="dvd-case-scene"
      classList={{ 'dvd-case-scene--open': props.open }}
      ref={sceneEl}
    >
      <div class="dvd-case" aria-hidden="true">
        <span
          class="dvd-case__spine"
          style={{ 'background-image': `url('${props.art}')` }}
        >
          <span class="dvd-case__spine-title">{props.name}</span>
        </span>
        <span
          class="dvd-case__front"
          style={{ 'background-image': `url('${props.art}')` }}
        />
        <span class="dvd-case__bottom" />
      </div>
      <A
        href={props.href}
        class="dvd-case__hit"
        title={props.open ? `Play ${props.name}` : `Open ${props.name}`}
        aria-label={props.open ? `Play ${props.name}` : `Open ${props.name}`}
        aria-expanded={props.open}
        onClick={props.onActivate}
      />
      <button
        type="button"
        class="dvd-case__close"
        title={`Close ${props.name}`}
        aria-label={`Close ${props.name}`}
        aria-hidden={!props.open ? 'true' : undefined}
        tabIndex={props.open ? 0 : -1}
        onClick={props.onClose}
      >
        <CloseIcon />
      </button>
      <A
        href={props.href}
        class="dvd-case__play"
        title={`Play ${props.name}`}
        aria-label={`Play ${props.name}`}
        aria-hidden={!props.open ? 'true' : undefined}
        tabIndex={props.open ? 0 : -1}
      >
        <PlayIcon />
      </A>
    </div>
  );
}

export const Catalogue: Component<{
  /** Disc currently open in the viewer (`/play/:dir`). */
  selectedDir?: string;
  dvds: DvdListItem[] | undefined;
  loading?: boolean;
  error?: string | null;
}> = (props) => {
  const [expanded, setExpanded] = createSignal<string | null>(null);

  const hasPosters = createMemo(() =>
    (props.dvds ?? []).some((d) => Boolean(d.poster)),
  );

  // Expand when the URL-selected disc *changes* — don't fight a manual close.
  createEffect((prev: string | undefined) => {
    const sel = props.selectedDir;
    if (sel && sel !== prev) {
      setExpanded(sel);
    }
    return sel;
  });

  /** First click opens the case; second click (already open) selects it in the viewer. */
  function onCaseActivate(dir: string, e: MouseEvent) {
    if (expanded() === dir) return;
    e.preventDefault();
    setExpanded(dir);
  }

  function onCaseClose(dir: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (expanded() === dir) {
      setExpanded(null);
    }
  }

  return (
    <div class="catalogue">
      <Show when={props.loading}>
        <p class="muted">Loading catalogue…</p>
      </Show>
      <Show when={props.error}>
        <p class="error">{props.error}</p>
      </Show>
      <Show when={!props.loading && !props.error}>
        <ul class="spine-tower" aria-label="DVD archive">
          <For each={props.dvds ?? []} fallback={<p class="muted">No discs yet.</p>}>
            {(dvd) => {
              const isOpen = () => expanded() === dvd.dir;
              const isPlaying = () => props.selectedDir === dvd.dir;
              return (
                <li
                  class="spine-row"
                  classList={{
                    'spine-row--expanded': isOpen(),
                    'spine-row--playing': isPlaying(),
                  }}
                >
                  <DvdCaseScene
                    open={isOpen()}
                    href={`/play/${dvd.dir}`}
                    name={dvd.name}
                    art={artUrl(dvd)}
                    onActivate={(e) => onCaseActivate(dvd.dir, e)}
                    onClose={(e) => onCaseClose(dvd.dir, e)}
                  />
                </li>
              );
            }}
          </For>
        </ul>
        <Show when={hasPosters()}>
          <p class="tmdb-attribution">
            This product uses the{' '}
            <a
              href="https://www.themoviedb.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              TMDB
            </a>{' '}
            API but is not endorsed or certified by TMDB.
          </p>
        </Show>
      </Show>
    </div>
  );
};
