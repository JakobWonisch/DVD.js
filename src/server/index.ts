// Serve converted DVD assets.

'use strict';

import * as http from 'node:http';
import { join as pathJoin } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import connect from 'connect';
import cors from 'cors';
import serveStatic from 'serve-static';

import appConfig from '../loadAppConfig.js';
import {
  ensureDiscReady,
  isSafeDiscId,
  startDiscCacheEviction,
  touchAccess,
  isDiscReady,
  warnIfWebFolderNotWritable,
} from './discCache.js';
import {
  VIEWER_REPORTS_DEFAULTS,
  viewerReportsMiddleware,
} from './viewerReports.js';

/**
 * GET /api/disc/:discId/ensure — start decompress if needed; report status.
 */
function discEnsureMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  var url = req.url || '';
  var match = /^\/api\/disc\/([^/]+)\/ensure\/?$/.exec(url.split('?')[0]);
  if (!match || (req.method !== 'GET' && req.method !== 'HEAD')) {
    next();
    return;
  }

  var discId = decodeURIComponent(match[1]);
  if (!isSafeDiscId(discId)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ status: 'missing', discId: discId }));
    return;
  }

  try {
    var status = ensureDiscReady(appConfig.webFolder, discId);
    res.statusCode = status === 'missing' ? 404 : 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ status: status, discId: discId }));
  } catch (err) {
    console.error('ensureDiscReady failed for ' + discId, err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({
        status: 'missing',
        discId: discId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/**
 * Refresh cache TTL when static assets under /:discId/ are served.
 * Only useful when eviction is enabled.
 */
function discAccessTouchMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  if (!appConfig.evictDiscCache) {
    next();
    return;
  }
  var url = req.url || '';
  var match = /^\/([^/]+)\//.exec(url.split('?')[0]);
  if (match) {
    var discId = decodeURIComponent(match[1]);
    if (
      isSafeDiscId(discId) &&
      isDiscReady(appConfig.webFolder, discId)
    ) {
      try {
        touchAccess(appConfig.webFolder, discId);
      } catch {
        // ignore touch failures
      }
    }
  }
  next();
}


/**
 * Never serve stored bug reports as static files (dot-dir is usually ignored,
 * but deny explicitly so a serve-static `dotfiles: allow` cannot leak them).
 */
function blockReportsStaticMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  var url = (req.url || '').split('?')[0];
  if (
    url === '/.dvd-menu-archive-reports' ||
    url.indexOf('/.dvd-menu-archive-reports/') === 0
  ) {
    res.statusCode = 404;
    res.end();
    return;
  }
  next();
}

/**
 * Start the server.
 */
function startServer() {
  warnIfWebFolderNotWritable(appConfig.webFolder);

  if (appConfig.evictDiscCache) {
    startDiscCacheEviction(appConfig.webFolder);
  }

  var reportsCfg = {
    reportsFolder:
      appConfig.reportsFolder ||
      pathJoin(appConfig.webFolder, '.dvd-menu-archive-reports'),
    maxReports:
      appConfig.reportsMaxCount ?? VIEWER_REPORTS_DEFAULTS.maxReports,
    maxTotalBytes:
      appConfig.reportsMaxTotalBytes ?? VIEWER_REPORTS_DEFAULTS.maxTotalBytes,
    maxBodyBytes:
      appConfig.reportsMaxBodyBytes ?? VIEWER_REPORTS_DEFAULTS.maxBodyBytes,
    rateLimitPerIp: VIEWER_REPORTS_DEFAULTS.rateLimitPerIp,
    rateLimitWindowMs: VIEWER_REPORTS_DEFAULTS.rateLimitWindowMs,
  };

  // Solid viewer build (dist/viewer) first; legacy public/ keeps test/parse-ifo tools.
  var app = connect()
    .use(cors({ origin: true }))
    .use(discEnsureMiddleware)
    .use(viewerReportsMiddleware(reportsCfg))
    .use(blockReportsStaticMiddleware)
    .use(discAccessTouchMiddleware)
    .use(serveStatic('dist/viewer/'))
    .use(serveStatic('public/'))
    .use(serveStatic(appConfig.webFolder));
  http.createServer(app).listen(appConfig.staticServerPort);

  console.log('Server running at http://localhost:%d/', appConfig.staticServerPort);
  console.log('webFolder: %s', appConfig.webFolder);
}

startServer();
