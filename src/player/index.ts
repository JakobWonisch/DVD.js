// A class to manage everything related to the video player.

'use strict';


import * as utils from '../utils.js';

/** User-facing copy when title WebMs were omitted (menu-only archive). */
export const TITLE_UNAVAILABLE_MESSAGE =
  'This title was intentionally left out of this archive. Only menus were converted.';

class Player {
  private screen: HTMLVideoElement;
  private unavailableEl: HTMLElement | null = null;

  constructor(screen: HTMLVideoElement) {
    this.screen = screen;
  }

  /**
   * Execute a callback.
   *
   * @param {string} path
   * @param {string} file
   * @param {function} callback
   */
  initializeVideoSource(path, file, callback) {
    if (!file) {
      setTimeout(callback, 0);
      return;
    }

    file = utils.convertVobPath('/' + path + file);
    console.log('file', file);

    var self = this;
    this.assetExists(file, function(exists) {
      if (!exists) {
        self.showTitleUnavailable();
        setTimeout(callback, 0);
        return;
      }

      self.hideTitleUnavailable();

      if (self.screen.paused) {
        // The video is paused, we update the src and start playing.
        self.screen.src = file;
        self.screen.play();
      } else {
        // Otherwise, we wait until the current video playback finishes to switch the video.
        var changeSource = function() {
          console.log('HTMLVideoElement ended event');

          self.screen.src = file;
          self.screen.play();

          self.screen.removeEventListener('ended', changeSource, false);
        };
        self.screen.addEventListener('ended', changeSource, false);
      }

      setTimeout(callback, 0);
    });
  }

  /**
   * Probe whether a converted asset URL is present (HEAD, then GET fallback).
   */
  assetExists(url: string, callback: (exists: boolean) => void) {
    if (typeof fetch !== 'function') {
      callback(true);
      return;
    }

    fetch(url, { method: 'HEAD' })
      .then(function(res) {
        if (res.ok) {
          callback(true);
          return;
        }
        // Some static servers omit HEAD; try a ranged GET.
        return fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } })
          .then(function(getRes) {
            callback(getRes.ok || getRes.status === 206);
          });
      })
      .catch(function() {
        callback(false);
      });
  }

  showTitleUnavailable(message?: string) {
    var text = message || TITLE_UNAVAILABLE_MESSAGE;
    try {
      this.screen.pause();
    } catch (e) {
      // ignore
    }
    this.screen.removeAttribute('src');
    this.screen.load();

    var host = this.screen.parentElement || this.screen;
    if (getComputedStyle(host).position === 'static') {
      (host as HTMLElement).style.position = 'relative';
    }

    if (!this.unavailableEl) {
      this.unavailableEl = document.createElement('div');
      this.unavailableEl.className = 'dvd-menu-archive-title-unavailable';
      this.unavailableEl.setAttribute('role', 'status');
      this.unavailableEl.style.cssText =
        'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
        'background:rgba(0,0,0,0.85);color:#fff;font:16px/1.4 sans-serif;text-align:center;' +
        'padding:1.5rem;z-index:20;box-sizing:border-box;';
      host.appendChild(this.unavailableEl);
    }
    this.unavailableEl.textContent = text;
    this.unavailableEl.hidden = false;
  }

  hideTitleUnavailable() {
    if (this.unavailableEl) {
      this.unavailableEl.hidden = true;
    }
  }

  /**
   * Update the video source if required.
   */
  appendVideoChunk() {
  }
}

export default Player;
