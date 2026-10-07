import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  listPackableDiscIds,
  resolvePackDiscIds,
} from '../../src/server/convert/packOnly.js';

function makeWeb(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dvd-menu-archive-pack-only-'));
}

describe('listPackableDiscIds', () => {
  it('lists dirs with metadata.json and skips archives/junk', () => {
    var web = makeWeb();
    fs.mkdirSync(path.join(web, 'Shrek'));
    fs.writeFileSync(path.join(web, 'Shrek', 'metadata.json'), '[]\n');
    fs.mkdirSync(path.join(web, 'Empty'));
    fs.writeFileSync(path.join(web, 'Other.tar.gz'), 'x');
    fs.mkdirSync(path.join(web, '.hidden'));
    fs.writeFileSync(path.join(web, '.hidden', 'metadata.json'), '[]\n');

    expect(listPackableDiscIds(web)).toEqual(['Shrek']);
    fs.rmSync(web, { recursive: true, force: true });
  });
});

describe('resolvePackDiscIds', () => {
  it('defaults to all packable ids', () => {
    var web = makeWeb();
    fs.mkdirSync(path.join(web, 'A'));
    fs.writeFileSync(path.join(web, 'A', 'metadata.json'), '[]\n');
    fs.mkdirSync(path.join(web, 'B'));
    fs.writeFileSync(path.join(web, 'B', 'metadata.json'), '[]\n');
    expect(resolvePackDiscIds(web, [])).toEqual(['A', 'B']);
    fs.rmSync(web, { recursive: true, force: true });
  });

  it('resolves names under webFolder', () => {
    var web = makeWeb();
    fs.mkdirSync(path.join(web, 'Shrek'));
    fs.writeFileSync(path.join(web, 'Shrek', 'metadata.json'), '[]\n');
    expect(resolvePackDiscIds(web, ['Shrek'])).toEqual(['Shrek']);
    fs.rmSync(web, { recursive: true, force: true });
  });
});
