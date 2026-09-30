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
    // Same for titlePgcMedia (stubs/includedPgcs) and menuCell.buttons arrays.
    if (Array.isArray(content) && Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) {
        if (!value[i] || typeof value[i] !== 'object') {
          continue;
        }
        if (!content[i]) {
          content[i] = {};
        }
        if (value[i].menu && typeof value[i].menu === 'object') {
          content[i].menu = value[i].menu;
        }
        if (value[i].titlePgcMedia && typeof value[i].titlePgcMedia === 'object') {
          content[i].titlePgcMedia = value[i].titlePgcMedia;
        }
        if (value[i].menuCell && typeof value[i].menuCell === 'object') {
          if (!content[i].menuCell || typeof content[i].menuCell !== 'object') {
            content[i].menuCell = {};
          }
          var srcCells = value[i].menuCell;
          var dstCells = content[i].menuCell;
          Object.keys(srcCells).forEach(function (cellId) {
            var srcVobs = srcCells[cellId];
            if (!srcVobs || typeof srcVobs !== 'object') {
              return;
            }
            if (!dstCells[cellId] || typeof dstCells[cellId] !== 'object') {
              dstCells[cellId] = {};
            }
            Object.keys(srcVobs).forEach(function (vobId) {
              var srcEntry = srcVobs[vobId];
              if (!srcEntry || typeof srcEntry !== 'object') {
                return;
              }
              if (!dstCells[cellId][vobId] || typeof dstCells[cellId][vobId] !== 'object') {
                dstCells[cellId][vobId] = {};
              }
              var dstEntry = dstCells[cellId][vobId];
              Object.keys(srcEntry).forEach(function (k) {
                dstEntry[k] = srcEntry[k];
              });
              // Explicit clears from convert (buttonless reconvert).
              if (Object.prototype.hasOwnProperty.call(srcEntry, 'buttons')) {
                dstEntry.buttons = srcEntry.buttons;
              }
              if (Object.prototype.hasOwnProperty.call(srcEntry, 'hliDelaySec')) {
                if (srcEntry.hliDelaySec == null) {
                  delete dstEntry.hliDelaySec;
                } else {
                  dstEntry.hliDelaySec = srcEntry.hliDelaySec;
                }
              }
            });
          });
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
