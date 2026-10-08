import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import getDVDList from '../../src/server/utils/getDVDList.js';

describe('getDVDList', () => {
  it('includes poster sidecar when present', async () => {
    var webFolder = fs.mkdtempSync(
      path.join(os.tmpdir(), 'dvd-menu-archive-list-'),
    );
    var discId = 'Shrek';
    var dir = path.join(webFolder, discId);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'metadata.json'), '[]\n');
    fs.writeFileSync(path.join(webFolder, discId + '.cover.jpg'), 'c');
    fs.writeFileSync(path.join(webFolder, discId + '.poster.jpg'), 'p');
    // Archive so list accepts the disc without full unpack readiness markers.
    fs.writeFileSync(path.join(webFolder, discId + '.tar.gz'), 'fake');

    var list = await new Promise<
      Array<{
        name: string;
        dir: string;
        cover: string;
        poster?: string;
        tmdbId?: number;
      }>
    >(function (resolve) {
      getDVDList(webFolder, resolve);
    });

    expect(list).toEqual([
      {
        name: 'Shrek',
        dir: 'Shrek',
        cover: 'Shrek.cover.jpg',
        poster: 'Shrek.poster.jpg',
      },
    ]);

    fs.rmSync(webFolder, { recursive: true, force: true });
  });

  it('uses TMDB identity title and id when .tmdb.json exists', async () => {
    var webFolder = fs.mkdtempSync(
      path.join(os.tmpdir(), 'dvd-menu-archive-list-id-'),
    );
    var discId = 'Shrek_D1';
    fs.writeFileSync(path.join(webFolder, discId + '.tar.gz'), 'fake');
    fs.writeFileSync(
      path.join(webFolder, discId + '.tmdb.json'),
      JSON.stringify({
        tmdbId: 808,
        mediaType: 'movie',
        title: 'Shrek',
        year: 2001,
      }),
    );

    var list = await new Promise<
      Array<{
        name: string;
        dir: string;
        cover: string;
        poster?: string;
        tmdbId?: number;
      }>
    >(function (resolve) {
      getDVDList(webFolder, resolve);
    });

    expect(list).toEqual([
      {
        name: 'Shrek (2001)',
        dir: 'Shrek_D1',
        cover: 'Shrek_D1/cover.jpg',
        tmdbId: 808,
      },
    ]);

    fs.rmSync(webFolder, { recursive: true, force: true });
  });
});
