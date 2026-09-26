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
        return buildXMenuTag(videos, id) + buildVideoTag(videos, id);
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
          '" lang="' +
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
            tpl += '<img src="' + menuCell.still + '">';

            var btnCount = menuCell.btn_nb || 0;
            for (var i = 0; i < btnCount; i++) {
              tpl += '<input type="button" data-id="' + i + '" class="btn">';
            }
          }
        }

        tpl += '</x-menu>';
      });
    });

    return tpl;
  }

  function buildVideoTag(videos, id) {
    // Title VOBs live in `video`; menu VOBs in `index`. Prefer title, else menu.
    var sources = [];
    if (videos && Array.isArray(videos.video)) {
      sources = sources.concat(videos.video);
    }
    if (!sources.length && videos && Array.isArray(videos.index)) {
      sources = sources.concat(videos.index);
    }

    var hasTracks = videos && Array.isArray(videos.vtt) && videos.vtt.length > 0;
    if (!sources.length && !hasTracks) {
      // Always emit a video slot so vm.js playByID("video-N") can resolve the domain.
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
