/// <reference types="vite/client" />

import type { JSX } from 'solid-js';

declare module 'solid-js' {
  namespace JSX {
    interface IntrinsicElements {
      'x-video': JSX.HTMLAttributes<HTMLElement> & {
        controls?: boolean;
      };
      'x-menu': JSX.HTMLAttributes<HTMLElement> & {
        lang?: string;
        'data-domain'?: string | number;
        'data-cell'?: string | number;
        'data-vob'?: string | number;
        'data-still-time'?: string | number;
        'data-cells'?: string;
        'data-spu-height'?: string | number;
      };
      'crt-effect': JSX.HTMLAttributes<HTMLElement> & {
        preset?:
          | 'fallout'
          | 'dos'
          | 'cyberpunk'
          | 'arcade'
          | 'commodore64'
          | 'apple2'
          | 'vt100'
          | 'minimal';
        fill?: boolean | string;
        enabled?: boolean | string;
        'attr:enabled'?: string;
        'attr:preset'?: string;
        'attr:fill'?: string;
        'attr:enable-glow'?: string;
        'attr:enable-glare'?: string;
        'attr:enable-curvature'?: string;
      };
    }
  }
}

export {};
