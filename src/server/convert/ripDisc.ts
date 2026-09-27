/**
 * Rip / decrypt a DVD source into a writable VIDEO_TS tree.
 *
 * Stub — CSS decryption belongs only here (via dvdbackup + libdvdcss), never
 * in encode/convert/upload. Linux first (`/dev/sr*`, system dvdbackup);
 * Windows/macOS device paths and binary lookup come later.
 *
 * @see AGENTS.md — Standalone converter app → Where CSS decryption sits
 */

'use strict';

/** Options for a decrypting rip. */
export type RipOptions = {
  /** Optical device, ISO path, or mount point. */
  source: string;
  /** Writable directory that will contain the ripped disc folder. */
  workDir: string;
  /**
   * When true, only copy menu VOBs if the rip tool supports it.
   * Default dvdbackup `-M` copies the full disc structure; menu-only filter
   * may be applied after rip or via a future flag.
   */
  menusOnly?: boolean;
};

/** Result of a rip attempt. */
export type RipResult = {
  ok: boolean;
  /** Path to the disc root that contains VIDEO_TS (when ok). */
  dvdPath?: string;
  message: string;
};

/**
 * Decrypt and copy a disc/ISO into workDir.
 * Not implemented — will shell out to dvdbackup (libdvdcss) on Linux.
 *
 * @param {RipOptions} _options
 * @returns {Promise<RipResult>}
 */
export default async function ripDisc(_options: RipOptions): Promise<RipResult> {
  return {
    ok: false,
    message:
      'Rip/decrypt is not implemented yet (stub). Point convert at a decrypted VIDEO_TS folder, or install dvdbackup and rip manually.',
  };
}
