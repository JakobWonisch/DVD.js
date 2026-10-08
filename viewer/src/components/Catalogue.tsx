import {
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

function artUrl(dvd: DvdListItem): string {
  if (dvd.poster) {
    return '/' + dvd.poster;
  }
  return '/' + (dvd.cover || dvd.dir + '/cover.jpg');
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
    <div class="dvd-case-scene" ref={sceneEl}>
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
    </div>
  );
}

export const Catalogue: Component = () => {
  const [dvds, setDvds] = createSignal<DvdListItem[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [expanded, setExpanded] = createSignal<string | null>(null);

  const hasPosters = createMemo(() =>
    dvds().some((d) => Boolean(d.poster)),
  );

  onMount(async () => {
    try {
      const res = await fetch('/dvds.json');
      if (!res.ok) {
        throw new Error(
          `Could not load /dvds.json (${res.status}). Is webFolder configured and convert finished?`,
        );
      }
      const data = (await res.json()) as DvdListItem[];
      setDvds(
        [...data].sort((a, b) =>
          a.name > b.name ? 1 : a.name < b.name ? -1 : 0,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  });

  /** First click opens the case; second click (already open) navigates to play. */
  function onCaseActivate(dir: string, e: MouseEvent) {
    if (expanded() === dir) return;
    e.preventDefault();
    setExpanded(dir);
  }

  return (
    <div class="catalogue">
      <Show when={loading()}>
        <p class="muted">Loading catalogue…</p>
      </Show>
      <Show when={error()}>
        <p class="error">{error()}</p>
      </Show>
      <Show when={!loading() && !error()}>
        <ul class="spine-tower" aria-label="DVD archive">
          <For each={dvds()} fallback={<p class="muted">No discs yet.</p>}>
            {(dvd) => {
              const isOpen = () => expanded() === dvd.dir;
              return (
                <li
                  class="spine-row"
                  classList={{ 'spine-row--expanded': isOpen() }}
                >
                  <DvdCaseScene
                    open={isOpen()}
                    href={`/play/${dvd.dir}`}
                    name={dvd.name}
                    art={artUrl(dvd)}
                    onActivate={(e) => onCaseActivate(dvd.dir, e)}
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
