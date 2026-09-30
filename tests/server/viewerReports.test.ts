import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  reportsStorageSnapshot,
  resetViewerReportRateLimits,
  storeViewerReport,
  type ViewerReportsConfig,
} from '../../src/server/viewerReports.js';

function tempCfg(overrides: Partial<ViewerReportsConfig> = {}): ViewerReportsConfig {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'dvd-menu-archive-reports-'),
  );
  return {
    reportsFolder: dir,
    maxReports: 3,
    maxTotalBytes: 8 * 1024,
    maxBodyBytes: 4 * 1024,
    rateLimitPerIp: 10,
    rateLimitWindowMs: 60_000,
    ...overrides,
  };
}

afterEach(function () {
  resetViewerReportRateLimits();
});

describe('storeViewerReport', function () {
  it('stores a report and rejects when count cap is reached', function () {
    const cfg = tempCfg({ maxReports: 2, maxTotalBytes: 1024 * 1024 });
    const a = storeViewerReport(cfg, { log: 'hello a', discId: 'disc' });
    const b = storeViewerReport(cfg, { log: 'hello b', discId: 'disc' });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    const full = storeViewerReport(cfg, { log: 'hello c', discId: 'disc' });
    expect(full).toEqual({ ok: false, reason: 'storage_full' });

    const snap = reportsStorageSnapshot(cfg);
    expect(snap.count).toBe(2);
    expect(snap.full).toBe(true);
  });

  it('rejects empty logs', function () {
    const cfg = tempCfg();
    expect(storeViewerReport(cfg, { log: '   ' })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects when total byte budget would be exceeded', function () {
    const cfg = tempCfg({
      maxReports: 50,
      maxTotalBytes: 1500,
      maxBodyBytes: 4000,
    });
    const chunk = 'x'.repeat(400);
    const first = storeViewerReport(cfg, { log: chunk });
    expect(first.ok).toBe(true);
    // Another similarly sized report should exceed the total budget.
    const second = storeViewerReport(cfg, { log: chunk });
    expect(second).toEqual({ ok: false, reason: 'storage_full' });
  });

  it('rate-limits by IP', function () {
    const cfg = tempCfg({
      maxReports: 50,
      maxTotalBytes: 1024 * 1024,
      rateLimitPerIp: 2,
    });
    expect(
      storeViewerReport(cfg, { log: 'one' }, { ip: '1.2.3.4' }).ok,
    ).toBe(true);
    expect(
      storeViewerReport(cfg, { log: 'two' }, { ip: '1.2.3.4' }).ok,
    ).toBe(true);
    expect(storeViewerReport(cfg, { log: 'three' }, { ip: '1.2.3.4' })).toEqual(
      { ok: false, reason: 'rate_limited' },
    );
    expect(
      storeViewerReport(cfg, { log: 'other' }, { ip: '9.9.9.9' }).ok,
    ).toBe(true);
  });
});
