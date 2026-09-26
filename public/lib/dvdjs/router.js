/* global Backbone, $, _, buildTag, init, fp_pgc */
'use strict';

// Catalogue + player router (Backbone). Loads dvds.json then a disc's vm.js.

var listTpl = _.template(
  '<ul>' +
    '<% _.each(dvds, function(dvd) { %>' +
    '<li class="thumbnail" style="background-image:url(\'<%= dvd.dir %>/cover.jpg\');">' +
    '<a href="#play/<%= dvd.dir %>"><span><%= dvd.name %></span></a>' +
    '</li>' +
    '<% }); %>' +
    '</ul>'
);

var App = Backbone.Router.extend({
  routes: {
    play: 'list',
    'play/:dvdId': 'play',
  },

  list: function () {
    $.getJSON('/dvds.json')
      .done(function (data) {
        data = data.sort(function (a, b) {
          return a.name > b.name ? 1 : a.name < b.name ? -1 : 0;
        });
        $('.video-container').html(listTpl({ dvds: data }));
      })
      .fail(function (xhr) {
        $('.video-container').html(
          '<p class="text-danger">Could not load /dvds.json (' +
            xhr.status +
            '). Is webFolder configured and convert finished?</p>'
        );
      });
  },

  play: function (dvdId) {
    $.getJSON('/' + dvdId + '/metadata.json')
      .done(function (data) {
        $('.video-container').html(buildTag(data));

        var g = document.createElement('script');
        var s = document.scripts[0];
        g.src = '/' + dvdId + '/vm.js';
        s.parentNode.insertBefore(g, s);
        g.onload = function () {
          console.log('Start the DVD.');
          window.dvd = document.querySelector('x-video');

          if (typeof init === 'function') {
            init();
          }
          // Prefer a menu language that exists on this disc (IFO may not be "en").
          if (typeof MPGCIUT !== 'undefined' && Array.isArray(MPGCIUT)) {
            MPGCIUT.forEach(function (obj) {
              if (!obj) {
                return;
              }
              var keys = Object.keys(obj).filter(function (k) {
                return !/^\d+$/.test(k);
              });
              if (keys.length && typeof lang !== 'undefined' && keys.indexOf(lang) === -1) {
                lang = keys[0];
              }
            });
          }
          // Harden onmenu for domains without MENU_TYPES (common after JumpTT).
          if (window.dvd) {
            window.dvd.onmenu = function () {
              var menu = null;
              var domainMenus =
                typeof MENU_TYPES !== 'undefined' &&
                MENU_TYPES[domain] &&
                MENU_TYPES[domain][lang];
              var vmgmMenus =
                typeof MENU_TYPES !== 'undefined' &&
                MENU_TYPES[0] &&
                MENU_TYPES[0][lang];
              if (domainMenus && domainMenus[3]) {
                menu = domainMenus[3];
              } else if (vmgmMenus && vmgmMenus[2]) {
                menu = vmgmMenus[2];
              }
              if (menu && MPGCIUT[menu.domain] && MPGCIUT[menu.domain][menu.lang]) {
                MPGCIUT[menu.domain][menu.lang][menu.pgc].run();
              }
            };
          }
          if (typeof fp_pgc === 'function') {
            fp_pgc();
          }
        };
        g.onerror = function () {
          $('.video-container').append(
            '<p class="text-danger">Failed to load /' + dvdId + '/vm.js</p>'
          );
        };
      })
      .fail(function (xhr) {
        $('.video-container').html(
          '<p class="text-danger">Could not load /' +
            dvdId +
            '/metadata.json (' +
            xhr.status +
            ')</p>'
        );
      });
  },
});

var app = new App();
Backbone.history.start();

// Force the catalogue route on first load (hash may already be empty).
app.navigate('play', { trigger: true });
