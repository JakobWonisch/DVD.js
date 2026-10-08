/** Ambient shims for legacy DVD.js code and CJS packages without complete types. */

declare const $: any;

declare module 'jdataview' {
  class jDataView {
    constructor(
      buffer: ArrayBuffer | Buffer | number[] | string,
      offset?: number,
      length?: number,
      littleEndian?: boolean,
    );
    [key: string]: any;
  }

  export default jDataView;
}

interface jDataViewStatic {
  new (
    buffer: ArrayBuffer | Buffer | number[] | string,
    offset?: number,
    length?: number,
    littleEndian?: boolean,
  ): any;
}
