import type { Component } from 'solid-js';
import {
  handleMenuNavAction,
  type MenuKeyHost,
  type MenuNavAction,
} from '../host/menuKeys.js';

type Props = {
  host: MenuKeyHost | null | undefined;
};

const ACTIONS: { action: MenuNavAction; label: string; className: string }[] = [
  { action: 'up', label: 'Up', className: 'virtual-remote__btn--up' },
  { action: 'left', label: 'Left', className: 'virtual-remote__btn--left' },
  { action: 'enter', label: 'Enter', className: 'virtual-remote__btn--enter' },
  { action: 'right', label: 'Right', className: 'virtual-remote__btn--right' },
  { action: 'down', label: 'Down', className: 'virtual-remote__btn--down' },
];

function glyph(action: MenuNavAction): string {
  switch (action) {
    case 'up':
      return '▲';
    case 'down':
      return '▼';
    case 'left':
      return '◀';
    case 'right':
      return '▶';
    case 'enter':
      return '●';
  }
}

export const VirtualRemote: Component<Props> = (props) => {
  const press = (action: MenuNavAction, event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    const host = props.host;
    if (!host) {
      return;
    }
    handleMenuNavAction(host, action);
  };

  return (
    <div
      class="virtual-remote"
      role="group"
      aria-label="Virtual remote"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div class="virtual-remote__pad">
        {ACTIONS.map(({ action, label, className }) => (
          <button
            type="button"
            class={`virtual-remote__btn ${className}`}
            aria-label={label}
            onPointerDown={(e) => {
              // Fire on press (not click) so touch feels immediate; ignore
              // secondary buttons / multi-touch duplicates.
              if (e.button !== 0) {
                return;
              }
              press(action, e);
            }}
          >
            <span aria-hidden="true">{glyph(action)}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
