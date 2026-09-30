// Create or append data to a metadata file formatted in JSON.

'use strict';

import { loadJsonFile } from './loadJson.js';

import * as fs from 'node:fs';
import * as path from 'node:path';
import _ from 'lodash';

export default editMetadataFile;

function editMetadataFile(file, value, callback) {
  var content: any = [];
  // We check if the file exists.
  fs.exists(file, function(exists) {
    if (exists) {
      content = loadJsonFile(file);
    }

    // Now, we append the data.
    content = _.merge(content, value);

    // Replace domain `menu` wholesale after merge — _.merge keeps stale PGC /
    // cell array slots from prior converts (wrong stills / LinkNext targets).
    if (Array.isArray(content) && Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) {
        if (value[i] && value[i].menu && typeof value[i].menu === 'object') {
          if (!content[i]) {
            content[i] = {};
          }
          content[i].menu = value[i].menu;
        }
      }
    }

    fs.writeFile(file, JSON.stringify(content), function(err) {
      if (err) {
        console.error(err);
      }

      process.stdout.write('.');

      callback();
    });
  });
}
