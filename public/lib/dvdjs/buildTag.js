// Output HTML tags given the content of a metadata file.
'use strict';

function buildTag(metadata) {
  if (!Array.isArray(metadata)) {
    return '';
  }

  return (
    '<x-video controls style="width: 100%; max-width: 720px; max-height: 480px;">' +
    metadata
      .map(function (videos, id) {
        return (
          buildXMenuTag(videos, id) +
          buildMenuVideoTag(videos, id) +
          buildVideoTag(videos, id)
        );
      })
      .join('') +
    '</x-video>'
  );

  function buildXMenuTag(videos, id) {
    var tpl = '';
    var menusByLang = videos && videos.menu;

    if (!menusByLang) {
      return tpl;
    }

    Object.keys(menusByLang).forEach(function (lang) {
      var menus = menusByLang[lang] || [];
      menus.forEach(function (menu) {
        var cellID = menu.cellID;
        var vobID = menu.vobID;
        var cellsAttr = '';
        if (menu.cells && menu.cells.length) {
          cellsAttr =
            ' data-cells="' +
            encodeURIComponent(JSON.stringify(menu.cells)) +
            '"';
        }

        tpl +=
          '<x-menu id="menu-' +
          lang +
          '-' +
          id +
          '-' +
          menu.pgc +
          '" data-domain="' +
          id +
          '" data-cell="' +
          cellID +
          '" data-vob="' +
          vobID +
          '" data-still-time="' +
          (menu.still_time || 0) +
          '"' +
          cellsAttr +
          ' lang="' +
          lang +
          '">';

        var menuCell =
          videos.menuCell &&
          cellID != null &&
          vobID != null &&
          videos.menuCell[String(cellID)] &&
          videos.menuCell[String(cellID)][String(vobID)];

        if (menuCell) {
          if (menuCell.still) {
            if (menuCell.css) {
              tpl += '<link href="' + menuCell.css + '" rel="stylesheet">';
            }
            tpl +=
              '<img class="menu-still" src="' + menuCell.still + '" alt="">';

            if (menuCell.spu) {
              tpl +=
                '<img class="menu-spu" src="' +
                menuCell.spu +
                '" alt="" aria-hidden="true">';
            }
            if (menuCell.spuFrameHeight) {
              tpl = tpl.replace(
                'id="menu-' + lang + '-' + id + '-' + menu.pgc + '"',
                'id="menu-' +
                  lang +
                  '-' +
                  id +
                  '-' +
                  menu.pgc +
                  '" data-spu-height="' +
                  menuCell.spuFrameHeight +
                  '"'
              );
            }

            var spuSelect = menuCell.spuSelect || [];
            var spuActivate = menuCell.spuActivate || [];
            for (var s = 0; s < spuSelect.length; s++) {
              tpl +=
                '<img class="menu-spu-sel" data-id="' +
                s +
                '" hidden src="' +
                spuSelect[s] +
                '" alt="" aria-hidden="true">';
            }
            for (var a = 0; a < spuActivate.length; a++) {
              tpl +=
                '<img class="menu-spu-act" data-id="' +
                a +
                '" hidden src="' +
                spuActivate[a] +
                '" alt="" aria-hidden="true">';
            }

            var btnCount = menuCell.btn_nb || 0;
            var buttons = menuCell.buttons || [];
            var hasSpuHighlight = spuSelect.length > 0;
            for (var i = 0; i < btnCount; i++) {
              var nav = buttons[i] || {};
              tpl +=
                '<input type="button" data-id="' +
                i +
                '" class="btn' +
                (hasSpuHighlight ? ' btn-spu' : '') +
                '"' +
                (nav.up != null ? ' data-up="' + nav.up + '"' : '') +
                (nav.down != null ? ' data-down="' + nav.down + '"' : '') +
                (nav.left != null ? ' data-left="' + nav.left + '"' : '') +
                (nav.right != null ? ' data-right="' + nav.right + '"' : '') +
                (nav.auto_action_mode
                  ? ' data-auto-action="' + nav.auto_action_mode + '"'
                  : '') +
                '>';
            }
          }
        }

        tpl += '</x-menu>';
      });
    });

    return tpl;
  }

  /**
   * Menu VOB WebMs for motion-menu seek/play. Kept separate from title slots
   * so JumpTT on menus-only rips shows "not included" instead of playing menus.
   */
  function buildMenuVideoTag(videos, id) {
    if (!videos || !Array.isArray(videos.index) || !videos.index.length) {
      return '';
    }
    return (
      '<video id="menu-video-' +
      id +
      '" class="dvd-menu-archive-menu-video" src="' +
      videos.index[0] +
      '" preload="auto" loop="false" hidden></video>'
    );
  }

  function buildVideoTag(videos, id) {
    // Title VOBs only — never fall back to menu index (menus-only archives).
    var sources = [];
    if (videos && Array.isArray(videos.video)) {
      sources = sources.concat(videos.video);
    }

    var hasTracks = videos && Array.isArray(videos.vtt) && videos.vtt.length > 0;
    // Always emit a video slot so vm.js playByID("video-N") can resolve the domain.
    if (!sources.length && !hasTracks) {
      return '<video id="video-' + id + '"></video>';
    }

    var src = sources.length ? ' src="' + sources[0] + '"' : '';
    var vtt = hasTracks ? buildTracksTag(videos.vtt) : '';

    return '<video id="video-' + id + '"' + src + '>' + vtt + '</video>';

    function buildTracksTag(tracks) {
      return tracks
        .map(function (track, index) {
          var attr = index === 0 ? ' default' : '';
          return (
            '<track kind="chapters" src="' +
            track +
            '" srclang="en"' +
            attr +
            '/>'
          );
        })
        .join('');
    }
  }
}
