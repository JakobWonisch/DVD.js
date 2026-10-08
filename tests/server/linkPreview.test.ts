import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  GENERIC_DESCRIPTION,
  LOGO_IMAGE_PATH,
  SITE_NAME,
  absoluteUrl,
  buildLinkPreviewMetaHtml,
  escapeHtmlAttr,
  injectLinkPreview,
  isSpaShellPath,
  playDiscIdFromPath,
  resolveLinkPreview,
} from '../../src/server/linkPreview.js';

function tempWebFolder(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dvd-menu-archive-og-'));
}

describe('linkPreview helpers', function () {
  it('escapes HTML attribute text', function () {
    expect(escapeHtmlAttr('a "b" & <c>')).toBe('a &quot;b&quot; &amp; &lt;c&gt;');
  });

  it('builds absolute URLs', function () {
    expect(absoluteUrl('https://example.com/', '/play/Shrek')).toBe(
      'https://example.com/play/Shrek',
    );
  });

  it('parses play paths and SPA shell paths', function () {
    expect(playDiscIdFromPath('/play/Shrek')).toBe('Shrek');
    expect(playDiscIdFromPath('/play/Foo%20Bar/')).toBe('Foo Bar');
    expect(playDiscIdFromPath('/')).toBeNull();
    expect(isSpaShellPath('/')).toBe(true);
    expect(isSpaShellPath('/play/Shrek')).toBe(true);
    expect(isSpaShellPath('/copyright')).toBe(true);
    expect(isSpaShellPath('/assets/index.js')).toBe(false);
  });
});

describe('resolveLinkPreview', function () {
  it('returns the generic site preview with the logo', function () {
    const web = tempWebFolder();
    const preview = resolveLinkPreview(web, null);
    expect(preview).toEqual({
      title: SITE_NAME,
      description: GENERIC_DESCRIPTION,
      imagePath: LOGO_IMAGE_PATH,
      pagePath: '/',
      twitterCard: 'summary',
    });
  });

  it('prefers TMDB poster over generated cover', function () {
    const web = tempWebFolder();
    fs.writeFileSync(
      path.join(web, 'dvds.json'),
      JSON.stringify([
        {
          name: 'Shrek (2001)',
          dir: 'Shrek',
          cover: 'Shrek.cover.jpg',
          poster: 'Shrek.poster.jpg',
        },
      ]),
    );
    fs.writeFileSync(path.join(web, 'Shrek.cover.jpg'), 'fake-cover');
    fs.writeFileSync(path.join(web, 'Shrek.poster.jpg'), 'fake-poster');

    const preview = resolveLinkPreview(web, 'Shrek');
    expect(preview.title).toBe('View the menu of "Shrek (2001)"');
    expect(preview.imagePath).toBe('/Shrek.poster.jpg');
    expect(preview.pagePath).toBe('/play/Shrek');
    expect(preview.twitterCard).toBe('summary_large_image');
  });

  it('falls back to generated cover when poster is missing', function () {
    const web = tempWebFolder();
    fs.writeFileSync(
      path.join(web, 'dvds.json'),
      JSON.stringify([
        {
          name: 'Shrek (2001)',
          dir: 'Shrek',
          cover: 'Shrek.cover.jpg',
        },
      ]),
    );
    fs.writeFileSync(path.join(web, 'Shrek.cover.jpg'), 'fake-cover');

    const preview = resolveLinkPreview(web, 'Shrek');
    expect(preview.imagePath).toBe('/Shrek.cover.jpg');
    expect(preview.twitterCard).toBe('summary_large_image');
  });

  it('falls back to formatted dir name and logo when art is missing', function () {
    const web = tempWebFolder();
    fs.writeFileSync(
      path.join(web, 'dvds.json'),
      JSON.stringify([{ name: 'Only Name', dir: 'Only_Name' }]),
    );
    const preview = resolveLinkPreview(web, 'Only_Name');
    expect(preview.title).toBe('View the menu of "Only Name"');
    expect(preview.imagePath).toBe(LOGO_IMAGE_PATH);
    expect(preview.twitterCard).toBe('summary');
  });
});

describe('injectLinkPreview', function () {
  it('replaces the marked preview block in index.html', function () {
    const html = `<!doctype html><html><head>
    <!--dvd-menu-archive-link-preview-->
    <title>Old</title>
    <!--/dvd-menu-archive-link-preview-->
  </head><body></body></html>`;
    const out = injectLinkPreview(
      html,
      {
        title: 'View the menu of "Shrek"',
        description: 'Browse the DVD menu of "Shrek" in DVD Menu Archive.',
        imagePath: '/Shrek.cover.jpg',
        pagePath: '/play/Shrek',
        twitterCard: 'summary_large_image',
      },
      'https://archive.example',
    );
    expect(out).toContain('og:title" content="View the menu of &quot;Shrek&quot;"');
    expect(out).toContain(
      'og:image" content="https://archive.example/Shrek.cover.jpg"',
    );
    expect(out).toContain('og:url" content="https://archive.example/play/Shrek"');
    expect(out).not.toContain('<title>Old</title>');
    expect(buildLinkPreviewMetaHtml(
      {
        title: 'DVD Menu Archive',
        description: GENERIC_DESCRIPTION,
        imagePath: LOGO_IMAGE_PATH,
        pagePath: '/',
        twitterCard: 'summary',
      },
      'http://localhost:3000',
    )).toContain('twitter:card" content="summary"');
  });
});
