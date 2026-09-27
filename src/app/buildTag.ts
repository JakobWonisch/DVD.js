// Output HTML tags given the content of a metadata file.

'use strict';


function buildTag(metadata) {
  if (!Array.isArray(metadata)) {
    return '';
  }

  return `<x-video controls style="width: 100%; max-width: 720px; max-height: 480px;">` +
    metadata
      .map((videos, id) => {
        return buildXMenuTag(videos, id) + buildMenuVideoTag(videos, id) + buildVideoTag(videos, id);
      })
      .join(``) +
    `</x-video>`;

  function buildXMenuTag(videos, id) {
    var tpl = ``;
    var menusByLang = videos && videos.menu;

    if (!menusByLang) {
      return tpl;
    }

    for (var lang in menusByLang) {
      (menusByLang[lang] || []).forEach(menu => {
        var cellID = menu.cellID;
        var vobID = menu.vobID;
        var cellsAttr = menu.cells && menu.cells.length
          ? ` data-cells="${encodeURIComponent(JSON.stringify(menu.cells))}"`
          : ``;

        tpl += `<x-menu id="menu-${lang}-${id}-${menu.pgc}"
          data-domain="${id}" data-cell="${cellID}" data-vob="${vobID}"
          data-still-time="${menu.still_time || 0}"${cellsAttr}
          lang="${lang}">`;

        var menuCell =
          videos.menuCell &&
          cellID != null &&
          vobID != null &&
          videos.menuCell[String(cellID)] &&
          videos.menuCell[String(cellID)][String(vobID)];

        if (menuCell && menuCell.still) {
          if (menuCell.css) {
            tpl += `<link href="${menuCell.css}" rel="stylesheet">`;
          }
          tpl += `<img class="menu-still" src="${menuCell.still}" alt="">`;

          var btnCount = menuCell.btn_nb || 0;
          var buttons = menuCell.buttons || [];
          for (var i = 0; i < btnCount; i++) {
            var nav = buttons[i] || {};
            tpl += `<input type="button" data-id="${i}" class="btn"` +
              (nav.up != null ? ` data-up="${nav.up}"` : ``) +
              (nav.down != null ? ` data-down="${nav.down}"` : ``) +
              (nav.left != null ? ` data-left="${nav.left}"` : ``) +
              (nav.right != null ? ` data-right="${nav.right}"` : ``) +
              (nav.auto_action_mode ? ` data-auto-action="${nav.auto_action_mode}"` : ``) +
              `>`;
          }
        }

        tpl += `</x-menu>`;
      });
    }

    return tpl;
  }

  function buildMenuVideoTag(videos, id) {
    if (!videos || !Array.isArray(videos.index) || !videos.index.length) {
      return ``;
    }
    return `<video id="menu-video-${id}" class="dvdjs-menu-video" src="${videos.index[0]}" preload="metadata" hidden></video>`;
  }

  function buildVideoTag(videos, id) {
    var sources = [];
    if (videos && Array.isArray(videos.video)) {
      sources = sources.concat(videos.video);
    }

    var hasTracks = videos && Array.isArray(videos.vtt) && videos.vtt.length > 0;
    if (!sources.length && !hasTracks) {
      return `<video id="video-${id}"></video>`;
    }

    var src = sources.length ? ` src="${sources[0]}"` : ``;
    var vtt = hasTracks ? buildTracksTag(videos.vtt) : ``;

    return `<video id="video-${id}"${src}>${vtt}</video>`;

    function buildTracksTag(tracks) {
      return tracks
        .map((track, index) => {
          var attr = (index === 0) ? ` default` : ``;

          return `<track kind="chapters" src="${track}" srclang="en"${attr}/>`;
        })
        .join(``);
    }
  }
}
