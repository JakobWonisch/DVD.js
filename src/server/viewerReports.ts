/**
 * Store viewer session-log bug reports with hard caps (count + total bytes).
 * Prevents storage bombing while keeping recent reports for review.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type ViewerReportsConfig = {
  /** Directory for report JSON files. */
  reportsFolder: string;
  /** Max stored report files (oldest deleted when exceeded after a successful write attempt...). */
  maxReports: number;
  /** Max total size of all reports on disk (bytes). */
  maxTotalBytes: number;
  /** Max accepted POST body (bytes). */
  maxBodyBytes: number;
  /** Max reports per client IP per window. */
  rateLimitPerIp: number;
  /** Rate-limit window (ms). */
  rateLimitWindowMs: number;
};

export const VIEWER_REPORTS_DEFAULTS: Omit<ViewerReportsConfig, 'reportsFolder'> =
  {
    maxReports: 100,
    maxTotalBytes: 50 * 1024 * 1024,
    maxBodyBytes: 512 * 1024,
    rateLimitPerIp: 5,
    rateLimitWindowMs: 60 * 60 * 1000,
  };

type ReportFile = { name: string; path: string; size: number; mtimeMs: number };

type RateBucket = { count: number; resetAt: number };
const rateByIp = new Map<string, RateBucket>();

export type StoreReportResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'storage_full' | 'rate_limited' | 'too_large' | 'invalid' };

function listReports(dir: string): ReportFile[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const names = fs.readdirSync(dir);
  const out: ReportFile[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) {
      continue;
    }
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) {
        continue;
      }
      out.push({
        name,
        path: full,
        size: st.size,
        mtimeMs: st.mtimeMs,
      });
    } catch {
      // ignore
    }
  }
  out.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return out;
}

export function reportsStorageSnapshot(
  cfg: ViewerReportsConfig,
): { count: number; totalBytes: number; full: boolean } {
  const files = listReports(cfg.reportsFolder);
  let totalBytes = 0;
  for (const f of files) {
    totalBytes += f.size;
  }
  const full =
    files.length >= cfg.maxReports || totalBytes >= cfg.maxTotalBytes;
  return { count: files.length, totalBytes, full };
}

function clientIp(req: IncomingMessage): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) {
    return xf.split(',')[0].trim().slice(0, 128);
  }
  if (Array.isArray(xf) && xf[0]) {
    return String(xf[0]).split(',')[0].trim().slice(0, 128);
  }
  return (req.socket.remoteAddress || 'unknown').slice(0, 128);
}

function checkRateLimit(
  ip: string,
  cfg: ViewerReportsConfig,
): boolean {
  const now = Date.now();
  let bucket = rateByIp.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + cfg.rateLimitWindowMs };
    rateByIp.set(ip, bucket);
  }
  if (bucket.count >= cfg.rateLimitPerIp) {
    return false;
  }
  bucket.count += 1;
  return true;
}

/** Test helper — clear in-memory rate buckets. */
export function resetViewerReportRateLimits(): void {
  rateByIp.clear();
}

export function storeViewerReport(
  cfg: ViewerReportsConfig,
  body: {
    discId?: string;
    href?: string;
    userAgent?: string;
    note?: string;
    log?: string;
    sessionStartedAt?: string;
    entryCount?: number;
  },
  opts?: { ip?: string },
): StoreReportResult {
  const logText = typeof body.log === 'string' ? body.log : '';
  if (!logText.trim()) {
    return { ok: false, reason: 'invalid' };
  }

  // Approximate payload size before write.
  const approx =
    Buffer.byteLength(logText, 'utf8') +
    Buffer.byteLength(JSON.stringify({
      discId: body.discId,
      href: body.href,
      note: body.note,
    }), 'utf8') +
    512;
  if (approx > cfg.maxBodyBytes) {
    return { ok: false, reason: 'too_large' };
  }

  if (opts?.ip && !checkRateLimit(opts.ip, cfg)) {
    return { ok: false, reason: 'rate_limited' };
  }

  fs.mkdirSync(cfg.reportsFolder, { recursive: true });

  const snap = reportsStorageSnapshot(cfg);
  // Reserve room for this write.
  if (
    snap.count >= cfg.maxReports ||
    snap.totalBytes + approx > cfg.maxTotalBytes
  ) {
    return { ok: false, reason: 'storage_full' };
  }

  const id =
    new Date().toISOString().replace(/[:.]/g, '-') +
    '-' +
    crypto.randomBytes(4).toString('hex');
  const filePath = path.join(cfg.reportsFolder, id + '.json');

  const payload = {
    id,
    createdAt: new Date().toISOString(),
    discId: typeof body.discId === 'string' ? body.discId.slice(0, 200) : null,
    href: typeof body.href === 'string' ? body.href.slice(0, 2000) : null,
    userAgent:
      typeof body.userAgent === 'string' ? body.userAgent.slice(0, 500) : null,
    note: typeof body.note === 'string' ? body.note.slice(0, 2000) : null,
    sessionStartedAt:
      typeof body.sessionStartedAt === 'string'
        ? body.sessionStartedAt.slice(0, 64)
        : null,
    entryCount:
      typeof body.entryCount === 'number' && Number.isFinite(body.entryCount)
        ? body.entryCount
        : null,
    log: logText.slice(0, cfg.maxBodyBytes),
  };

  const json = JSON.stringify(payload, null, 2);
  if (Buffer.byteLength(json, 'utf8') > cfg.maxBodyBytes) {
    return { ok: false, reason: 'too_large' };
  }

  // Re-check after serialize (race with concurrent posts is best-effort).
  const snap2 = reportsStorageSnapshot(cfg);
  if (
    snap2.count >= cfg.maxReports ||
    snap2.totalBytes + Buffer.byteLength(json, 'utf8') > cfg.maxTotalBytes
  ) {
    return { ok: false, reason: 'storage_full' };
  }

  fs.writeFileSync(filePath, json, { encoding: 'utf8', flag: 'wx' });
  return { ok: true, id };
}

function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: 'too_large' | 'invalid' }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const finish = (
      result:
        | { ok: true; value: unknown }
        | { ok: false; reason: 'too_large' | 'invalid' },
    ) => {
      if (done) return;
      done = true;
      resolve(result);
    };
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        finish({ ok: false, reason: 'too_large' });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw.trim()) {
          finish({ ok: false, reason: 'invalid' });
          return;
        }
        finish({ ok: true, value: JSON.parse(raw) });
      } catch {
        finish({ ok: false, reason: 'invalid' });
      }
    });
    req.on('error', () => finish({ ok: false, reason: 'invalid' }));
  });
}

function jsonResponse(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * POST /api/reports — store a viewer session log.
 * GET  /api/reports/status — { full, count, maxReports } (no listing of contents).
 */
export function viewerReportsMiddleware(cfg: ViewerReportsConfig) {
  return function viewerReports(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ): void {
    const url = (req.url || '').split('?')[0];

    if (url === '/api/reports/status' && (req.method === 'GET' || req.method === 'HEAD')) {
      const snap = reportsStorageSnapshot(cfg);
      jsonResponse(res, 200, {
        full: snap.full,
        count: snap.count,
        maxReports: cfg.maxReports,
        maxTotalBytes: cfg.maxTotalBytes,
        totalBytes: snap.totalBytes,
      });
      return;
    }

    if (url !== '/api/reports') {
      next();
      return;
    }

    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Allow', 'POST');
      res.setHeader('Cache-Control', 'no-store');
      res.end();
      return;
    }

    void readJsonBody(req, cfg.maxBodyBytes).then((parsed) => {
      if (parsed.ok === false) {
        const reason = parsed.reason;
        jsonResponse(res, reason === 'too_large' ? 413 : 400, {
          ok: false,
          error: reason,
          message:
            reason === 'too_large'
              ? 'Report is too large.'
              : 'Invalid report payload.',
        });
        return;
      }
      const body = (parsed.value && typeof parsed.value === 'object'
        ? parsed.value
        : {}) as Record<string, unknown>;
      const result = storeViewerReport(
        cfg,
        {
          discId: typeof body.discId === 'string' ? body.discId : undefined,
          href: typeof body.href === 'string' ? body.href : undefined,
          userAgent:
            typeof body.userAgent === 'string'
              ? body.userAgent
              : typeof req.headers['user-agent'] === 'string'
                ? req.headers['user-agent']
                : undefined,
          note: typeof body.note === 'string' ? body.note : undefined,
          log: typeof body.log === 'string' ? body.log : undefined,
          sessionStartedAt:
            typeof body.sessionStartedAt === 'string'
              ? body.sessionStartedAt
              : undefined,
          entryCount:
            typeof body.entryCount === 'number' ? body.entryCount : undefined,
        },
        { ip: clientIp(req) },
      );

      if (result.ok === true) {
        jsonResponse(res, 201, { ok: true, id: result.id });
        return;
      }

      const failReason = result.reason;
      if (failReason === 'storage_full') {
        jsonResponse(res, 507, {
          ok: false,
          error: 'storage_full',
          message: 'Report storage is full. Please try again later.',
        });
        return;
      }
      if (failReason === 'rate_limited') {
        jsonResponse(res, 429, {
          ok: false,
          error: 'rate_limited',
          message: 'Too many reports from this address. Try again later.',
        });
        return;
      }
      if (failReason === 'too_large') {
        jsonResponse(res, 413, {
          ok: false,
          error: 'too_large',
          message: 'Report is too large.',
        });
        return;
      }
      jsonResponse(res, 400, {
        ok: false,
        error: 'invalid',
        message: 'Invalid report payload.',
      });
    });
  };
}
