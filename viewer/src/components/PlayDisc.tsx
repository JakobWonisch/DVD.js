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
import { loadAndStartVm } from '../vm/loadVm.js';
import type { DiscMetadata } from '../types/metadata.js';

async function fetchMetadata(dvdId: string): Promise<DiscMetadata> {
  const res = await fetch(`/${dvdId}/metadata.json`);
  if (!res.ok) {
    throw new Error(`Could not load /${dvdId}/metadata.json (${res.status})`);
  }
  return res.json();
}

export const PlayDisc: Component = () => {
  const params = useParams<{ dvdId: string }>();
  const [metadata] = createResource(
    () => params.dvdId,
    (id) => fetchMetadata(id),
  );
  const [hostEl, setHostEl] = createSignal<HTMLElement | null>(null);
  const [vmError, setVmError] = createSignal<string | null>(null);

  createEffect(() => {
    const id = params.dvdId;
    const meta = metadata();
    const host = hostEl();
    if (!id || !meta || !host) {
      return;
    }

    let disposed = false;
    let disposeVm: (() => void) | undefined;

    loadAndStartVm(id, host)
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        disposeVm = dispose;
      })
      .catch((e) => {
        if (!disposed) {
          setVmError(e instanceof Error ? e.message : String(e));
        }
      });

    onCleanup(() => {
      disposed = true;
      disposeVm?.();
      setVmError(null);
    });
  });

  return (
    <div class="player-stage">
      <Show when={metadata.loading}>
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
    </div>
  );
};
