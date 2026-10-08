/**
 * Open Graph / Twitter link-preview metadata for the catalogue SPA.
 *
 * Crawlers never see hash fragments, so previews are served for `/` and
 * `/play/:discId` (history URLs), with absolute og:image / og:url.
 */

'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { formatTitle } from '../utils.js';
import { isSafeDiscId } from './discCache.js';
import { loadJsonFile } from './utils/loadJson.js';

export const SITE_NAME = 'DVD Menu Archive';

/** Generic catalogue blurb when no disc is in the URL. */
export const GENERIC_DESCRIPTION =
  'Browse preserved DVD menus in the browser — still and motion menus, without downloading the full disc.';

/** Raster logo for crawlers (SVG is often rejected by social cards). */
export const LOGO_IMAGE_PATH = '/img/logo.png';

const PREVIEW_MARK_START = '<!--dvd-menu-archive-link-preview-->';
const PREVIEW_MARK_END = '<!--/dvd-menu-archive-link-preview-->';

export type LinkPreview = {
  title: string;
  description: string;
  /** Site-relative path beginning with `/`. */
  imagePath: string;
  /** Site-relative canonical path (`/` or `/play/:id`). */
  pagePath: string;
  twitterCard: 'summary' | 'summary_large_image';
};

type CatalogueEntry = {
  name?: string;
  dir?: string;
  cover?: string;
  poster?: string;
};

/**
 * Escape text for an HTML attribute value (double-quoted).
 */
export function escapeHtmlAttr(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Build an absolute URL from a request origin and a site path.
 */
export function absoluteUrl(origin: string, sitePath: string): string {
  var base = String(origin || '').replace(/\/+$/, '');
  var p = sitePath.startsWith('/') ? sitePath : '/' + sitePath;
  return base + p;
}

/**
 * Origin for absolute og:* URLs (honours reverse-proxy headers).
 */
export function requestOrigin(req: IncomingMessage): string {
  var xfProto = headerFirst(req, 'x-forwarded-proto');
  var xfHost = headerFirst(req, 'x-forwarded-host');
  var host = xfHost || headerFirst(req, 'host') || 'localhost';
  var proto = xfProto || 'http';
  // First value only when proxies send comma-separated lists.
  proto = proto.split(',')[0].trim();
  host = host.split(',')[0].trim();
  if (proto !== 'https' && proto !== 'http') {
    proto = 'http';
  }
  return proto + '://' + host;
}

function headerFirst(req: IncomingMessage, name: string): string | undefined {
  var raw = req.headers[name];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return typeof raw === 'string' ? raw : undefined;
}

function readCatalogue(webFolder: string): CatalogueEntry[] {
  var metaPath = path.join(webFolder, 'dvds.json');
  if (!fs.existsSync(metaPath)) {
    return [];
  }
  try {
    var data = loadJsonFile(metaPath);
    return Array.isArray(data) ? (data as CatalogueEntry[]) : [];
  } catch {
    return [];
  }
}

function siteImagePath(rel: string | undefined): string | null {
  if (!rel || typeof rel !== 'string') {
    return null;
  }
  var trimmed = rel.replace(/^\/+/, '');
  if (!trimmed || trimmed.includes('..') || path.isAbsolute(trimmed)) {
    return null;
  }
  return '/' + trimmed;
}

function imageExists(webFolder: string, sitePath: string): boolean {
  var rel = sitePath.replace(/^\/+/, '');
  try {
    return fs.statSync(path.join(webFolder, rel)).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve link-preview fields for the catalogue home or a disc play URL.
 */
export function resolveLinkPreview(
  webFolder: string,
  discId: string | null | undefined,
): LinkPreview {
  if (!discId) {
    return {
      title: SITE_NAME,
      description: GENERIC_DESCRIPTION,
      imagePath: LOGO_IMAGE_PATH,
      pagePath: '/',
      twitterCard: 'summary',
    };
  }

  var safe = isSafeDiscId(discId) ? discId : null;
  var entry: CatalogueEntry | undefined;
  if (safe) {
    var list = readCatalogue(webFolder);
    entry = list.find(function (d) {
      return d && d.dir === safe;
    });
  }

  var titleName =
    (entry && typeof entry.name === 'string' && entry.name) ||
    (safe ? formatTitle(safe) : 'DVD');
  var title = 'View the menu of "' + titleName + '"';
  var description =
    'Browse the DVD menu of "' + titleName + '" in ' + SITE_NAME + '.';

  var imagePath = LOGO_IMAGE_PATH;
  var twitterCard: LinkPreview['twitterCard'] = 'summary';
  if (safe) {
    // Prefer TMDB poster; fall back to convert-generated menu cover.
    var candidates = [
      siteImagePath(entry && entry.poster),
      siteImagePath(safe + '.poster.jpg'),
      siteImagePath(entry && entry.cover),
      siteImagePath(safe + '.cover.jpg'),
      siteImagePath(safe + '/cover.jpg'),
    ];
    for (var i = 0; i < candidates.length; i++) {
      var cand = candidates[i];
      if (cand && imageExists(webFolder, cand)) {
        imagePath = cand;
        twitterCard = 'summary_large_image';
        break;
      }
    }
  }

  return {
    title: title,
    description: description,
    imagePath: imagePath,
    pagePath: '/play/' + encodeURIComponent(safe || discId),
    twitterCard: twitterCard,
  };
}

/**
 * Build the HTML block of title + meta tags for a preview.
 */
export function buildLinkPreviewMetaHtml(
  preview: LinkPreview,
  origin: string,
): string {
  var pageUrl = absoluteUrl(origin, preview.pagePath);
  var imageUrl = absoluteUrl(origin, preview.imagePath);
  var t = escapeHtmlAttr(preview.title);
  var d = escapeHtmlAttr(preview.description);
  var site = escapeHtmlAttr(SITE_NAME);
  var lines = [
    PREVIEW_MARK_START,
    '<title>' + escapeHtmlAttr(preview.title) + '</title>',
    '<meta name="description" content="' + d + '" />',
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="' + site + '" />',
    '<meta property="og:title" content="' + t + '" />',
    '<meta property="og:description" content="' + d + '" />',
    '<meta property="og:url" content="' + escapeHtmlAttr(pageUrl) + '" />',
    '<meta property="og:image" content="' + escapeHtmlAttr(imageUrl) + '" />',
    '<meta name="twitter:card" content="' + preview.twitterCard + '" />',
    '<meta name="twitter:title" content="' + t + '" />',
    '<meta name="twitter:description" content="' + d + '" />',
    '<meta name="twitter:image" content="' + escapeHtmlAttr(imageUrl) + '" />',
    PREVIEW_MARK_END,
  ];
  return lines.join('\n    ');
}

/**
 * Inject (or replace) link-preview meta into an index.html document.
 */
export function injectLinkPreview(
  html: string,
  preview: LinkPreview,
  origin: string,
): string {
  var block = buildLinkPreviewMetaHtml(preview, origin);
  var marked =
    PREVIEW_MARK_START +
    '[\\s\\S]*?' +
    PREVIEW_MARK_END.replace('/', '\\/');
  if (new RegExp(marked).test(html)) {
    return html.replace(new RegExp(marked), block);
  }
  // Drop the static <title> so we do not end up with two.
  var withoutTitle = html.replace(/<title>[\s\S]*?<\/title>\s*/i, '');
  if (withoutTitle.includes('</head>')) {
    return withoutTitle.replace('</head>', '    ' + block + '\n  </head>');
  }
  return withoutTitle + block;
}

/**
 * Parse `/play/:discId` from a request pathname (no query).
 */
export function playDiscIdFromPath(pathname: string): string | null {
  var m = /^\/play\/([^/]+)\/?$/.exec(pathname);
  if (!m) {
    return null;
  }
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * Paths that should be served as the SPA shell (with optional disc preview).
 */
export function isSpaShellPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '/index.html') {
    return true;
  }
  if (pathname === '/copyright' || pathname === '/copyright/') {
    return true;
  }
  return playDiscIdFromPath(pathname) !== null;
}

type LinkPreviewMiddlewareOpts = {
  webFolder: string;
  /** Absolute path to the built viewer index.html. */
  indexHtmlPath: string;
};

/**
 * Serve index.html with Open Graph tags for `/`, `/play/:id`, and `/copyright`.
 */
export function linkPreviewMiddleware(opts: LinkPreviewMiddlewareOpts) {
  return function linkPreview(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    var url = req.url || '/';
    var pathname = url.split('?')[0];
    if (!isSpaShellPath(pathname)) {
      next();
      return;
    }

    var discId = playDiscIdFromPath(pathname);
    // Copyright page uses the generic site preview.
    var preview = resolveLinkPreview(
      opts.webFolder,
      pathname.startsWith('/play/') ? discId : null,
    );

    var html: string;
    try {
      html = fs.readFileSync(opts.indexHtmlPath, 'utf8');
    } catch (err) {
      console.error(
        'linkPreview: cannot read SPA shell at ' + opts.indexHtmlPath,
        err,
      );
      next();
      return;
    }

    var origin = requestOrigin(req);
    var body = injectLinkPreview(html, preview, origin);
    var buf = Buffer.from(body, 'utf8');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Cache-Control', 'no-cache');
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(buf);
  };
}
