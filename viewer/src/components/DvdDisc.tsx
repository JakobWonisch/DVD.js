import type { Component, JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import type {
  DiscMetadata,
  DomainMetadata,
  MenuButtonNav,
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
}> = (props) => (
  <For each={[...Array(props.count).keys()]}>
    {(i) => {
      const nav = () => props.buttons[i] || {};
      return (
        <input
          type="button"
          class="btn"
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
            return (
              <x-menu
                id={`menu-${lang}-${props.id}-${menu.pgc}`}
                data-domain={props.id}
                data-cell={menu.cellID}
                data-vob={menu.vobID}
                data-still-time={menu.still_time || 0}
                data-cells={cellsAttr()}
                lang={lang}
              >
                <Show when={cell()?.still}>
                  <Show when={cell()?.css}>
                    <link rel="stylesheet" href={cell()!.css!} />
                  </Show>
                  <img class="menu-still" src={cell()!.still!} alt="" />
                  <MenuButtons
                    count={cell()!.btn_nb || 0}
                    buttons={cell()!.buttons || []}
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
          preload="metadata"
          hidden
        />
      </Show>
      <video id={`video-${props.id}`} src={titleSrc() || undefined}>
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
