// Create a JSON containing the list of available DVD.

'use strict';


import * as fs from 'node:fs';
import * as path from 'node:path';

import getDVDList from '../utils/getDVDList.js';
import appConfig from '../../loadAppConfig.js';

export default generateCatalogue;

function generateCatalogue(callback) {
  process.stdout.write('\nRegenerating the list of DVD:\n');

  getDVDList(appConfig.webFolder, function(availableDvds) {
    var metaPath = path.join(appConfig.webFolder, 'dvds.json');
    fs.writeFile(metaPath, JSON.stringify(availableDvds), function(err) {
      if (err) {
        console.error(err);
      }

      process.stdout.write('.');

      callback();
    });
  });
}
