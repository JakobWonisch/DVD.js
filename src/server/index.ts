// Serve converted DVD assets and advertise on the local network.

'use strict';

import * as http from 'node:http';
import connect from 'connect';
import cors from 'cors';
import serveStatic from 'serve-static';
import mdns from 'mdns-js';

import appConfig from '../loadAppConfig.js';

/**
 * Start the server.
 */
function startServer() {
  var app = connect()
    .use(cors({ origin: true }))
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
