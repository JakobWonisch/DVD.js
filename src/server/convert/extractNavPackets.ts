// Extract NAV packets from VOB files.

'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';
import jDataView from 'jdataview';

import Stream from '../../server/utils/stream.js';
import decodePacket from '../../server/utils/decode_packet.js';
import * as navRead from '../../dvdread/nav_read.js';
import * as serverUtils from '../../server/utils/index.js';
import * as utils from '../../utils.js';
import { globFiles } from '../../server/utils/globFiles.js';
import { loadJsonFile } from '../utils/loadJson.js';
import {
  DVD_VIDEO_LB_LEN,
  nextVobuSectorFromNav,
  type NavPtsLike,
} from './menuStillSeek.js';

export default extractNav;

/** Max packs to scan forward when a predicted next sector is not a NAV. */
var NAV_SCAN_FORWARD = 64;

/**
 * Extract NAV packets from the VOB files located in a folder.
 *
 * Walk like libdvdnav: follow VOBU_SRI next_vobu; at end-of-cell or a broken
 * link, resume at the next uncovered menu_c_adt cell start (do not abandon the
 * rest of the VOB).
 *
 * @param {string} dvdPath
 * @param {function} callback
 */
function extractNav(dvdPath: string, callback) {
  process.stdout.write('\nExtracting NAV packets:\n');

  var webPath = serverUtils.getWebPath(dvdPath);

  var vobPath = path.join(dvdPath, 'VIDEO_TS', '*.VOB');
  globFiles(vobPath, function (err, vobFiles) {
    if (err) {
      console.error(err);
    }

    // Filter out non-menu VOB files as we only use these NAV packets for generating UI buttons.
    vobFiles = vobFiles.filter(serverUtils.isMenuVob);

    if (!vobFiles.length) {
      // Some DVD don't have menu at all.
      callback();
      return;
    }

    var pointer = 0;

    next(vobFiles[pointer]);

    function next(vobFile: string) {
      var name = path.basename(vobFile);

      fs.readFile(vobFile, function (err, data) {
        if (err) {
          console.error(err);
          if (
            err.code === 'EIO' ||
            err.code === 'EACCES' ||
            err.code === 'EPERM'
          ) {
            console.error(
              'Aborting NAV extract: cannot read ' +
                name +
                ' (' +
                err.code +
                '). CSS-protected discs need --rip (dvdbackup), e.g.:\n' +
                '  pnpm convert -- --rip --work-dir ~/dvd/work <source>',
            );
            process.exit(1);
          }
          advanceFile();
          return;
        }

        // Empty / stub menu VOBs (common on multi-title extras discs).
        if (!data || data.length < DVD_VIDEO_LB_LEN) {
          console.warn(
            'Skipping empty/invalid menu VOB:',
            name,
            '(' + (data ? data.length : 0) + ' bytes)',
          );
          advanceFile();
          return;
        }

        var p = new Stream(data);
        var lastSector = Math.floor(data.length / DVD_VIDEO_LB_LEN);
        var cellStarts = loadMenuCellStarts(webPath, name);
        var visited = new Set<number>();
        var resumeQueue = cellStarts.slice();

        extractFromSector(0x00);

        function extractFromSector(sector: number) {
          if (sector < 0 || sector >= lastSector) {
            resumeNextCell();
            return;
          }

          if (visited.has(sector)) {
            resumeNextCell();
            return;
          }

          try {
            p.seek(sector * DVD_VIDEO_LB_LEN);
            var navPackets = decodePacket(p);

            if (!navPackets.pci || !navPackets.dsi) {
              var scanned = scanForwardForNav(sector);
              if (scanned != null) {
                extractFromSector(scanned);
                return;
              }
              console.warn(
                'No NAV packet at sector',
                utils.toHex(sector),
                'in',
                name,
                '— resuming at next cell',
              );
              resumeNextCell();
              return;
            }

            var json = {
              pci: navRead.parsePCI(
                new jDataView(navPackets.pci, undefined, undefined, false),
              ),
              dsi: navRead.parseDSI(
                new jDataView(navPackets.dsi, undefined, undefined, false),
              ),
            };

            if (
              !json.dsi ||
              !json.dsi.dsi_gi ||
              json.dsi.dsi_gi.nv_pck_lbn == null ||
              json.dsi.dsi_gi.vobu_ea == null
            ) {
              console.warn(
                'Incomplete DSI at sector',
                utils.toHex(sector),
                'in',
                name,
                '— resuming at next cell',
              );
              resumeNextCell();
              return;
            }

            visited.add(sector);
            // Drop this sector from the resume queue if it was a cell start.
            resumeQueue = resumeQueue.filter(function (s) {
              return s !== sector;
            });

            var jsonPath = getNavFilename(name, sector);
            fs.writeFile(jsonPath, JSON.stringify(json), function (writeErr) {
              if (writeErr) {
                console.error(writeErr);
              }

              process.stdout.write('.');

              var nextSector = nextVobuSectorFromNav(
                sector,
                json as NavPtsLike,
              );

              if (
                nextSector != null &&
                nextSector > sector &&
                nextSector < lastSector &&
                !visited.has(nextSector)
              ) {
                setTimeout(function () {
                  extractFromSector(nextSector);
                }, 0);
              } else {
                resumeNextCell();
              }
            });
          } catch (parseErr) {
            console.warn(
              'Failed NAV extract at sector',
              utils.toHex(sector),
              'in',
              name + ':',
              parseErr && (parseErr as Error).message
                ? (parseErr as Error).message
                : parseErr,
            );
            resumeNextCell();
          }
        }

        function scanForwardForNav(fromSector: number): number | null {
          var limit = Math.min(
            lastSector,
            fromSector + NAV_SCAN_FORWARD,
          );
          for (var s = fromSector + 1; s < limit; s++) {
            if (visited.has(s)) {
              continue;
            }
            try {
              p.seek(s * DVD_VIDEO_LB_LEN);
              var packs = decodePacket(p);
              if (packs.pci && packs.dsi) {
                return s;
              }
            } catch (e) {
              // keep scanning
            }
          }
          return null;
        }

        function resumeNextCell() {
          while (resumeQueue.length) {
            var start = resumeQueue.shift();
            if (
              start == null ||
              start < 0 ||
              start >= lastSector ||
              visited.has(start)
            ) {
              continue;
            }
            setTimeout(function () {
              extractFromSector(start);
            }, 0);
            return;
          }
          advanceFile();
        }
      });
    }

    function advanceFile() {
      pointer++;
      if (pointer < vobFiles.length) {
        setTimeout(function () {
          next(vobFiles[pointer]);
        }, 0);
      } else {
        callback();
      }
    }
  });

  /**
   * Cell start sectors from converted IFO JSON (menu_c_adt), sorted.
   */
  function loadMenuCellStarts(webDir: string, vobName: string): number[] {
    var basename = vobName.replace(/\.VOB$/i, '');
    var ifoJsonPath = path.join(webDir, basename + '.json');
    try {
      if (!fs.existsSync(ifoJsonPath)) {
        return [];
      }
      var ifo = loadJsonFile(ifoJsonPath);
      var table = ifo && ifo.menu_c_adt && ifo.menu_c_adt.cell_adr_table;
      if (!Array.isArray(table)) {
        return [];
      }
      var starts: number[] = [];
      var seen = new Set<number>();
      for (var i = 0; i < table.length; i++) {
        var s = table[i] && table[i].start_sector;
        if (typeof s === 'number' && s >= 0 && !seen.has(s)) {
          seen.add(s);
          starts.push(s);
        }
      }
      starts.sort(function (a, b) {
        return a - b;
      });
      return starts;
    } catch (e) {
      return [];
    }
  }

  /**
   * Return the file path for the web given a file.
   * Used for naming both the NAV packet files and the metadata file.
   *
   * @param {string} name A file name.
   * @param {number} sector A file name.
   * @return {string}
   */
  function getNavFilename(name: string, sector: number): string {
    return path.join(webPath, getJsonFileName(name, sector));
  }
}

/**
 * Transform the file name of a JSON file.
 *
 * @param {string} name A file name.
 * @param {number} sector A file name.
 * @return {string}
 */
function getJsonFileName(name: string, sector: number): string {
  return name.replace(/\.VOB$/i, '') + '-' + utils.toHex(sector) + '.json';
}
