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
    }
  }
}

export {};
