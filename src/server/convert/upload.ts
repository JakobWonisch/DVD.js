/**
 * Upload a converted menu package to a remote media server.
 *
 * Stub only — empty header for a future uploader. The media server is out of
 * tree; this hook will POST/PUT the webFolder disc tree (WebM + JSON/CSS/JS +
 * stills), never raw VOBs or CSS-encrypted sources.
 *
 * @see AGENTS.md — Standalone converter app → Upload mode
 */

'use strict';

/** Options for uploading a converted disc package. */
export type UploadOptions = {
  /** Absolute path to the converted disc under webFolder. */
  packagePath: string;
  /** Media server base URL (future). */
  endpoint?: string;
  /** Optional auth token / API key (future). */
  token?: string;
};

/** Result of an upload attempt (future). */
export type UploadResult = {
  ok: boolean;
  message: string;
};

/**
 * Upload a converted menu package.
 * Not implemented — reserved for the media-server integration.
 *
 * @param {UploadOptions} _options
 * @returns {Promise<UploadResult>}
 */
export default async function uploadConvertedPackage(
  _options: UploadOptions,
): Promise<UploadResult> {
  return {
    ok: false,
    message:
      'Upload is not implemented yet (stub). Converted packages stay local under webFolder.',
  };
}
