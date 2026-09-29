import type { Component, JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import type {
  DiscMetadata,
  DomainMetadata,
  MenuButtonNav,
  MenuCellMeta,
  MenuPgcEntry,
} from '../types/metadata.js';

function menuCellFor(domain: DomainMetadata, menu: MenuPgcEntry) {
  const cellID = menu.cellID;
  const vobID = menu.vobID;
  if (cellID == null || vobID == null || !domain.menuCell) {
    return undefined;
  }
  return domain.menuCell[String(cellID)]?.[String(vobID)];
}

const MenuButtons: Component<{
  count: number;
  buttons: MenuButtonNav[];
  hasSpuHighlight: boolean;
}> = (props) => (
  <For each={[...Array(props.count).keys()]}>
    {(i) => {
      const nav = () => props.buttons[i] || {};
      return (
        <input
          type="button"
          classList={{
            btn: true,
            'btn-spu': props.hasSpuHighlight,
          }}
          data-id={i}
          data-up={nav().up}
          data-down={nav().down}
          data-left={nav().left}
          data-right={nav().right}
          data-auto-action={nav().auto_action_mode || undefined}
        />
      );
    }}
  </For>
);

const MenuOverlays: Component<{ cell: MenuCellMeta }> = (props) => {
  const sel = () => props.cell.spuSelect || [];
  const act = () => props.cell.spuActivate || [];
  return (
    <>
      <Show when={props.cell.spu}>
        <img
          class="menu-spu"
          src={props.cell.spu!}
          alt=""
          aria-hidden="true"
        />
      </Show>
      <For each={sel()}>
        {(src, i) => (
          <img
            class="menu-spu-sel"
            data-id={i()}
            hidden
            src={src}
            alt=""
            aria-hidden="true"
          />
        )}
      </For>
      <For each={act()}>
        {(src, i) => (
          <img
            class="menu-spu-act"
            data-id={i()}
            hidden
            src={src}
            alt=""
            aria-hidden="true"
          />
        )}
      </For>
    </>
  );
};

const DomainMenus: Component<{ domain: DomainMetadata; id: number }> = (
  props,
) => {
  const langs = () => Object.keys(props.domain.menu || {});
  return (
    <For each={langs()}>
      {(lang) => (
        <For each={props.domain.menu![lang] || []}>
          {(menu) => {
            const cell = () => menuCellFor(props.domain, menu);
            const cellsAttr = () =>
              menu.cells && menu.cells.length
                ? encodeURIComponent(JSON.stringify(menu.cells))
                : undefined;
            const hasSpu = () => (cell()?.spuSelect || []).length > 0;
            return (
              <x-menu
                id={`menu-${lang}-${props.id}-${menu.pgc}`}
                attr:data-domain={String(props.id)}
                attr:data-cell={
                  menu.cellID != null ? String(menu.cellID) : undefined
                }
                attr:data-vob={
                  menu.vobID != null ? String(menu.vobID) : undefined
                }
                attr:data-still-time={String(menu.still_time || 0)}
                attr:data-cells={cellsAttr()}
                attr:data-spu-height={
                  cell()?.spuFrameHeight != null
                    ? String(cell()!.spuFrameHeight)
                    : undefined
                }
                lang={lang}
              >
                {/* Still optional: motion menus swap assets in playMenuCell. */}
                <Show when={cell()?.css}>
                  <link rel="stylesheet" href={cell()!.css!} />
                </Show>
                <Show when={cell()?.still}>
                  <img class="menu-still" src={cell()!.still!} alt="" />
                </Show>
                <Show
                  when={
                    cell()?.spu ||
                    (cell()?.spuSelect || []).length > 0 ||
                    (cell()?.buttons || []).length > 0
                  }
                >
                  <MenuOverlays cell={cell()!} />
                  <MenuButtons
                    count={cell()!.btn_nb || (cell()!.buttons || []).length || 0}
                    buttons={cell()!.buttons || []}
                    hasSpuHighlight={hasSpu()}
                  />
                </Show>
              </x-menu>
            );
          }}
        </For>
      )}
    </For>
  );
};

const DomainVideos: Component<{ domain: DomainMetadata; id: number }> = (
  props,
) => {
  const menuSrc = () =>
    props.domain.index && props.domain.index.length
      ? props.domain.index[0]
      : undefined;
  const titleSrc = () =>
    props.domain.video && props.domain.video.length
      ? props.domain.video[0]
      : undefined;
  const tracks = () => props.domain.vtt || [];

  return (
    <>
      <Show when={menuSrc()}>
        <video
          id={`menu-video-${props.id}`}
          class="dvdjs-menu-video"
          src={menuSrc()}
          preload="auto"
          loop={false}
          hidden
        />
      </Show>
      <Show when={titleSrc()}>
        <video id={`video-${props.id}`} src={titleSrc()}>
          <For each={tracks()}>
            {(track, index) => (
              <track
                kind="chapters"
                src={track}
                srclang="en"
                default={index() === 0 || undefined}
              />
            )}
          </For>
        </video>
      </Show>
      <Show when={!titleSrc()}>
        {/* Keep id slot for JumpTT / playByID lookups on menus-only rips. */}
        <video id={`video-${props.id}`} hidden />
      </Show>
    </>
  );
};

export const DvdDisc: Component<{
  metadata: DiscMetadata;
  hostRef?: (el: HTMLElement) => void;
}> = (props) => {
  const setRef = (el: HTMLElement) => {
    props.hostRef?.(el);
  };

  return (
    <x-video ref={setRef as unknown as JSX.HTMLAttributes<HTMLElement>['ref']} controls>
      <For each={props.metadata}>
        {(domain, id) => (
          <>
            <DomainMenus domain={domain} id={id()} />
            <DomainVideos domain={domain} id={id()} />
          </>
        )}
      </For>
    </x-video>
  );
};
