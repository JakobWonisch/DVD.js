import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildStillPlaceholderPng,
  writeStillPlaceholder,
} from '../../src/server/convert/writeStillPlaceholder.js';

describe('buildStillPlaceholderPng', () => {
  it('returns a valid PNG signature', () => {
    const buf = buildStillPlaceholderPng('0-1-2', 64, 48);
    expect(buf.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )).toBe(true);
    expect(buf.length).toBeGreaterThan(32);
  });

  it('writes a readable file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvdjs-ph-'));
    const file = path.join(dir, 'menu-0-1-2.png');
    writeStillPlaceholder(file, '0-1-2', 80, 60);
    const stat = fs.statSync(file);
    expect(stat.size).toBeGreaterThan(32);
    const magic = Buffer.alloc(8);
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, magic, 0, 8, 0);
    fs.closeSync(fd);
    expect(magic[0]).toBe(137);
    expect(magic[1]).toBe(80);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
