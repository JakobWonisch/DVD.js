// Serve converted DVD assets and advertise on the local network.

'use strict';

import * as http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import connect from 'connect';
import cors from 'cors';
import serveStatic from 'serve-static';
import mdns from 'mdns-js';

import appConfig from '../loadAppConfig.js';
import {
  ensureDiscReady,
  isSafeDiscId,
  startDiscCacheEviction,
  touchAccess,
  isDiscReady,
} from './discCache.js';

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

  var status = ensureDiscReady(appConfig.webFolder, discId);
  res.statusCode = status === 'missing' ? 404 : 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ status: status, discId: discId }));
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
 * Start the server.
 */
function startServer() {
  if (appConfig.evictDiscCache) {
    startDiscCacheEviction(appConfig.webFolder);
  }

  // Solid viewer build (dist/viewer) first; legacy public/ keeps test/parse-ifo tools.
  var app = connect()
    .use(cors({ origin: true }))
    .use(discEnsureMiddleware)
    .use(discAccessTouchMiddleware)
    .use(serveStatic('dist/viewer/'))
    .use(serveStatic('public/'))
    .use(serveStatic(appConfig.webFolder));
  http.createServer(app).listen(appConfig.staticServerPort);

  console.log('Server running at http://localhost:%d/', appConfig.staticServerPort);
}

/**
 * Advertise the service.
 */
function advertiseService() {
  var service = mdns.createAdvertisement(mdns.tcp('_http'), 9876, {
    name: '_dvd_server',
  });

  service.start();
}

startServer();
advertiseService();
