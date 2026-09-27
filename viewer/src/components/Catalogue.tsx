import { createSignal, For, onMount, Show, type Component } from 'solid-js';
import { A } from '@solidjs/router';
import type { DvdListItem } from '../types/metadata.js';

export const Catalogue: Component = () => {
  const [dvds, setDvds] = createSignal<DvdListItem[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);

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

  return (
    <div class="catalogue">
      <Show when={loading()}>
        <p class="muted">Loading catalogue…</p>
      </Show>
      <Show when={error()}>
        <p class="error">{error()}</p>
      </Show>
      <Show when={!loading() && !error()}>
        <ul class="catalogue-grid">
          <For each={dvds()} fallback={<p class="muted">No discs yet.</p>}>
            {(dvd) => (
              <li
                class="thumbnail"
                style={{ 'background-image': `url('/${dvd.dir}/cover.jpg')` }}
              >
                <A href={`/play/${dvd.dir}`}>
                  <span>{dvd.name}</span>
                </A>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
};
