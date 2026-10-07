/*
 * dvdnav-oracle play — drive native libdvdnav with a line script, emit JSONL traces.
 *
 * Usage:
 *   dvdnav-oracle play --path /path/to/DVD_or_VIDEO_TS --script file.navscript
 *   dvdnav-oracle play --path ... < file.navscript
 *
 * Script lines (see tools/dvdnav-oracle/README.md):
 *   pump max=N until=still|wait|stop|cell|highlight|hop
 *   snapshot
 *   activate [button]
 *   select up|down|left|right
 *   select_button N
 *   still_skip
 *   wait_skip
 *   menu title|root|subpicture|audio|angle|part|escape
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <ctype.h>

#include <dvdnav/dvdnav.h>
#include <dvdnav/dvdnav_events.h>
#include <dvdnav/dvd_types.h>

#define DVD_BLOCK 2048
#define MAX_LINE 512

typedef struct {
  int vts;
  int domain; /* DVDDomain_t bits */
  int title;
  int pgcn;
  int pgn;
  int cell;
  int hl;
  int stopped;
} nav_state_t;

static int g_step = 0;

static const char *domain_name(int domain) {
  if (domain & DVD_DOMAIN_FirstPlay) return "fp";
  if (domain & DVD_DOMAIN_VMGM) return "vmgm";
  if (domain & DVD_DOMAIN_VTSMenu) return "vtsm";
  if (domain & DVD_DOMAIN_VTSTitle) return "title";
  return "unknown";
}

static const char *space_name(int domain) {
  if (domain & DVD_DOMAIN_FirstPlay) return "fp";
  if (domain & DVD_DOMAIN_VTSTitle) return "title";
  return "menu";
}

static void refresh_program(dvdnav_t *nav, nav_state_t *st) {
  int32_t title = 0, pgcn = 0, pgn = 0;
  if (dvdnav_current_title_program(nav, &title, &pgcn, &pgn) == DVDNAV_STATUS_OK) {
    st->title = title;
    st->pgcn = pgcn;
    st->pgn = pgn;
  }
  int32_t hl = 0;
  if (dvdnav_get_current_highlight(nav, &hl) == DVDNAV_STATUS_OK) {
    st->hl = hl;
  }
}

static void emit_pos(const char *event, const nav_state_t *st, const char *extra_json) {
  /* vts for VMGM/FP is 0; for VTSM/title use st->vts */
  int vts_out = 0;
  if (st->domain & (DVD_DOMAIN_VTSMenu | DVD_DOMAIN_VTSTitle)) {
    vts_out = st->vts;
  }
  printf(
    "{\"i\":%d,\"event\":\"%s\",\"space\":\"%s\",\"domain\":\"%s\",\"vts\":%d,"
    "\"title\":%d,\"pgc\":%d,\"pg\":%d,\"cell\":%d,\"hl\":%d",
    g_step++,
    event,
    space_name(st->domain),
    domain_name(st->domain),
    vts_out,
    st->title,
    st->pgcn,
    st->pgn,
    st->cell,
    st->hl
  );
  if (extra_json && extra_json[0]) {
    printf(",%s", extra_json);
  }
  printf("}\n");
  fflush(stdout);
}

static int parse_until_mask(const char *s) {
  /* bit flags */
  int m = 0;
  if (!s || !*s) return (1 << DVDNAV_STILL_FRAME) | (1 << DVDNAV_WAIT) | (1 << DVDNAV_STOP);
  char buf[256];
  strncpy(buf, s, sizeof(buf) - 1);
  buf[sizeof(buf) - 1] = 0;
  for (char *tok = strtok(buf, "|"); tok; tok = strtok(NULL, "|")) {
    while (*tok && isspace((unsigned char)*tok)) tok++;
    if (strcmp(tok, "still") == 0) m |= (1 << DVDNAV_STILL_FRAME);
    else if (strcmp(tok, "wait") == 0) m |= (1 << DVDNAV_WAIT);
    else if (strcmp(tok, "stop") == 0) m |= (1 << DVDNAV_STOP);
    else if (strcmp(tok, "cell") == 0) m |= (1 << DVDNAV_CELL_CHANGE);
    else if (strcmp(tok, "highlight") == 0) m |= (1 << DVDNAV_HIGHLIGHT);
    else if (strcmp(tok, "hop") == 0) m |= (1 << DVDNAV_HOP_CHANNEL);
    else if (strcmp(tok, "vts") == 0) m |= (1 << DVDNAV_VTS_CHANGE);
    else if (strcmp(tok, "menu") == 0) {
      m |= (1 << DVDNAV_STILL_FRAME) | (1 << DVDNAV_HIGHLIGHT) | (1 << DVDNAV_CELL_CHANGE);
    }
  }
  return m ? m : ((1 << DVDNAV_STILL_FRAME) | (1 << DVDNAV_WAIT) | (1 << DVDNAV_STOP));
}

static int pump(dvdnav_t *nav, nav_state_t *st, int max_blocks, int until_mask) {
  uint8_t buf[DVD_BLOCK];
  int blocks = 0;
  int hit = 0;

  while (blocks < max_blocks && !st->stopped) {
    int event = 0;
    int len = 0;
    if (dvdnav_get_next_block(nav, buf, &event, &len) != DVDNAV_STATUS_OK) {
      fprintf(stderr, "dvdnav-oracle play: get_next_block failed: %s\n",
              dvdnav_err_to_string(nav));
      return -1;
    }
    blocks++;

    switch (event) {
      case DVDNAV_BLOCK_OK:
      case DVDNAV_NOP:
      case DVDNAV_NAV_PACKET:
      case DVDNAV_SPU_CLUT_CHANGE:
      case DVDNAV_SPU_STREAM_CHANGE:
      case DVDNAV_AUDIO_STREAM_CHANGE:
        break;

      case DVDNAV_STILL_FRAME: {
        dvdnav_still_event_t *ev = (dvdnav_still_event_t *)buf;
        refresh_program(nav, st);
        char extra[64];
        snprintf(extra, sizeof(extra), "\"still\":%d", ev->length);
        /* Finite timed stills are intro/warning holds — auto-skip and keep
         * pumping. Only infinite stills (0xff) are interactive menu settles. */
        if (ev->length != 0xff) {
          emit_pos("still_timed", st, extra);
          dvdnav_still_skip(nav);
          break;
        }
        emit_pos("still", st, extra);
        if (until_mask & (1 << DVDNAV_STILL_FRAME)) {
          hit = 1;
          goto done;
        }
        break;
      }

      case DVDNAV_WAIT:
        refresh_program(nav, st);
        emit_pos("wait", st, NULL);
        if (until_mask & (1 << DVDNAV_WAIT)) {
          hit = 1;
          goto done;
        }
        dvdnav_wait_skip(nav);
        break;

      case DVDNAV_STOP:
        st->stopped = 1;
        refresh_program(nav, st);
        emit_pos("stop", st, NULL);
        hit = 1;
        goto done;

      case DVDNAV_CELL_CHANGE: {
        dvdnav_cell_change_event_t *ev = (dvdnav_cell_change_event_t *)buf;
        st->cell = ev->cellN;
        st->pgn = ev->pgN;
        refresh_program(nav, st);
        emit_pos("cell", st, NULL);
        if (until_mask & (1 << DVDNAV_CELL_CHANGE)) {
          hit = 1;
          goto done;
        }
        break;
      }

      case DVDNAV_VTS_CHANGE: {
        dvdnav_vts_change_event_t *ev = (dvdnav_vts_change_event_t *)buf;
        st->vts = ev->new_vtsN;
        st->domain = (int)ev->new_domain;
        refresh_program(nav, st);
        emit_pos("vts", st, NULL);
        if (until_mask & (1 << DVDNAV_VTS_CHANGE)) {
          hit = 1;
          goto done;
        }
        break;
      }

      case DVDNAV_HIGHLIGHT: {
        dvdnav_highlight_event_t *ev = (dvdnav_highlight_event_t *)buf;
        st->hl = (int)ev->buttonN;
        refresh_program(nav, st);
        emit_pos("highlight", st, NULL);
        if (until_mask & (1 << DVDNAV_HIGHLIGHT)) {
          hit = 1;
          goto done;
        }
        break;
      }

      case DVDNAV_HOP_CHANNEL:
        refresh_program(nav, st);
        emit_pos("hop", st, NULL);
        if (until_mask & (1 << DVDNAV_HOP_CHANNEL)) {
          hit = 1;
          goto done;
        }
        break;

      default:
        break;
    }
  }

done:
  refresh_program(nav, st);
  {
    char extra[80];
    snprintf(extra, sizeof(extra), "\"blocks\":%d,\"hit\":%s", blocks, hit ? "true" : "false");
    emit_pos("pump_end", st, extra);
  }
  return 0;
}

static pci_t *pci(dvdnav_t *nav) {
  return dvdnav_get_current_nav_pci(nav);
}

static int do_activate(dvdnav_t *nav, nav_state_t *st, int button /* 0 = current */) {
  pci_t *p = pci(nav);
  if (!p) {
    fprintf(stderr, "dvdnav-oracle play: no PCI for activate\n");
    return -1;
  }
  refresh_program(nav, st);
  if (button > 0) {
    char extra[40];
    snprintf(extra, sizeof(extra), "\"button\":%d", button);
    emit_pos("input_activate", st, extra);
    if (dvdnav_button_select_and_activate(nav, p, button) != DVDNAV_STATUS_OK) {
      fprintf(stderr, "dvdnav-oracle play: activate %d failed: %s\n",
              button, dvdnav_err_to_string(nav));
      emit_pos("activate_failed", st, extra);
      return 0; /* keep tracing — script/disc may not be in a menu yet */
    }
  } else {
    emit_pos("input_activate", st, "\"button\":0");
    if (dvdnav_button_activate(nav, p) != DVDNAV_STATUS_OK) {
      fprintf(stderr, "dvdnav-oracle play: activate current failed: %s\n",
              dvdnav_err_to_string(nav));
      emit_pos("activate_failed", st, "\"button\":0");
      return 0;
    }
  }
  refresh_program(nav, st);
  return 0;
}

static int do_select_dir(dvdnav_t *nav, nav_state_t *st, const char *dir) {
  pci_t *p = pci(nav);
  if (!p) return -1;
  char extra[48];
  snprintf(extra, sizeof(extra), "\"dir\":\"%s\"", dir);
  emit_pos("input_select", st, extra);
  dvdnav_status_t stt = DVDNAV_STATUS_ERR;
  if (strcmp(dir, "up") == 0) stt = dvdnav_upper_button_select(nav, p);
  else if (strcmp(dir, "down") == 0) stt = dvdnav_lower_button_select(nav, p);
  else if (strcmp(dir, "left") == 0) stt = dvdnav_left_button_select(nav, p);
  else if (strcmp(dir, "right") == 0) stt = dvdnav_right_button_select(nav, p);
  else {
    fprintf(stderr, "dvdnav-oracle play: bad dir %s\n", dir);
    return -1;
  }
  if (stt != DVDNAV_STATUS_OK) {
    fprintf(stderr, "dvdnav-oracle play: select %s failed: %s\n", dir, dvdnav_err_to_string(nav));
    return -1;
  }
  refresh_program(nav, st);
  emit_pos("pos", st, NULL);
  return 0;
}

static int do_select_button(dvdnav_t *nav, nav_state_t *st, int button) {
  pci_t *p = pci(nav);
  if (!p) return -1;
  char extra[40];
  snprintf(extra, sizeof(extra), "\"button\":%d", button);
  emit_pos("input_select_button", st, extra);
  if (dvdnav_button_select(nav, p, button) != DVDNAV_STATUS_OK) {
    fprintf(stderr, "dvdnav-oracle play: select_button %d failed: %s\n",
            button, dvdnav_err_to_string(nav));
    return -1;
  }
  refresh_program(nav, st);
  emit_pos("pos", st, NULL);
  return 0;
}

static int do_menu_call(dvdnav_t *nav, nav_state_t *st, const char *name) {
  DVDMenuID_t id = DVD_MENU_Root;
  if (strcmp(name, "escape") == 0) id = DVD_MENU_Escape;
  else if (strcmp(name, "title") == 0) id = DVD_MENU_Title;
  else if (strcmp(name, "root") == 0) id = DVD_MENU_Root;
  else if (strcmp(name, "subpicture") == 0) id = DVD_MENU_Subpicture;
  else if (strcmp(name, "audio") == 0) id = DVD_MENU_Audio;
  else if (strcmp(name, "angle") == 0) id = DVD_MENU_Angle;
  else if (strcmp(name, "part") == 0) id = DVD_MENU_Part;
  else {
    fprintf(stderr, "dvdnav-oracle play: unknown menu %s\n", name);
    return -1;
  }
  char extra[48];
  snprintf(extra, sizeof(extra), "\"menu\":\"%s\"", name);
  emit_pos("input_menu", st, extra);
  if (dvdnav_menu_call(nav, id) != DVDNAV_STATUS_OK) {
    fprintf(stderr, "dvdnav-oracle play: menu_call %s failed: %s\n",
            name, dvdnav_err_to_string(nav));
    return -1;
  }
  return 0;
}

static char *ltrim(char *s) {
  while (*s && isspace((unsigned char)*s)) s++;
  return s;
}

static void rtrim(char *s) {
  size_t n = strlen(s);
  while (n > 0 && isspace((unsigned char)s[n - 1])) {
    s[--n] = 0;
  }
}

static int run_script(dvdnav_t *nav, nav_state_t *st, FILE *fp) {
  char line[MAX_LINE];
  while (fgets(line, sizeof(line), fp)) {
    char *p = ltrim(line);
    rtrim(p);
    if (!*p || *p == '#') continue;

    if (strncmp(p, "pump", 4) == 0) {
      int max_blocks = 50000;
      int until_mask = parse_until_mask("still|wait|stop");
      char *rest = ltrim(p + 4);
      while (*rest) {
        if (strncmp(rest, "max=", 4) == 0) {
          max_blocks = atoi(rest + 4);
        } else if (strncmp(rest, "until=", 6) == 0) {
          char tmp[128];
          const char *src = rest + 6;
          size_t i = 0;
          while (src[i] && !isspace((unsigned char)src[i]) && i + 1 < sizeof(tmp)) {
            tmp[i] = src[i];
            i++;
          }
          tmp[i] = 0;
          until_mask = parse_until_mask(tmp);
        }
        while (*rest && !isspace((unsigned char)*rest)) rest++;
        while (*rest && isspace((unsigned char)*rest)) rest++;
      }
      if (pump(nav, st, max_blocks, until_mask) != 0) return -1;
    } else if (strcmp(p, "snapshot") == 0) {
      refresh_program(nav, st);
      emit_pos("pos", st, NULL);
    } else if (strncmp(p, "activate", 8) == 0) {
      char *rest = ltrim(p + 8);
      int button = 0;
      if (*rest) button = atoi(rest);
      if (do_activate(nav, st, button) != 0) return -1;
    } else if (strncmp(p, "select_button", 13) == 0) {
      int button = atoi(ltrim(p + 13));
      if (do_select_button(nav, st, button) != 0) return -1;
    } else if (strncmp(p, "select", 6) == 0) {
      char *dir = ltrim(p + 6);
      if (do_select_dir(nav, st, dir) != 0) return -1;
    } else if (strcmp(p, "still_skip") == 0) {
      emit_pos("input_still_skip", st, NULL);
      dvdnav_still_skip(nav);
    } else if (strcmp(p, "wait_skip") == 0) {
      emit_pos("input_wait_skip", st, NULL);
      dvdnav_wait_skip(nav);
    } else if (strncmp(p, "menu", 4) == 0) {
      if (do_menu_call(nav, st, ltrim(p + 4)) != 0) return -1;
    } else {
      fprintf(stderr, "dvdnav-oracle play: unknown script op: %s\n", p);
      return -1;
    }
  }
  return 0;
}

/* Resolve path: accept disc root or VIDEO_TS directory. */
static int resolve_dvd_path(const char *in, char *out, size_t outsz) {
  snprintf(out, outsz, "%s", in);
  size_t n = strlen(out);
  while (n > 1 && out[n - 1] == '/') {
    out[--n] = 0;
  }
  /* If path ends with VIDEO_TS, use parent (dvdnav wants disc root). */
  if (n >= 8 && strcmp(out + n - 8, "VIDEO_TS") == 0) {
    out[n - 8] = 0;
    n -= 8;
    while (n > 1 && out[n - 1] == '/') out[--n] = 0;
  }
  return 0;
}

int cmd_play(int argc, char **argv) {
  const char *path_arg = NULL;
  const char *script_path = NULL;

  for (int i = 0; i < argc; i++) {
    if (strcmp(argv[i], "--path") == 0) {
      if (++i >= argc) {
        fprintf(stderr, "dvdnav-oracle play: --path needs a value\n");
        return 2;
      }
      path_arg = argv[i];
    } else if (strcmp(argv[i], "--script") == 0) {
      if (++i >= argc) {
        fprintf(stderr, "dvdnav-oracle play: --script needs a value\n");
        return 2;
      }
      script_path = argv[i];
    } else {
      fprintf(stderr, "dvdnav-oracle play: unknown arg %s\n", argv[i]);
      return 2;
    }
  }

  if (!path_arg) {
    fprintf(stderr,
            "Usage: dvdnav-oracle play --path /path/to/DVD [--script file.navscript]\n");
    return 2;
  }

  char dvd_path[4096];
  resolve_dvd_path(path_arg, dvd_path, sizeof(dvd_path));

  dvdnav_t *nav = NULL;
  if (dvdnav_open(&nav, dvd_path) != DVDNAV_STATUS_OK || !nav) {
    fprintf(stderr, "dvdnav-oracle play: open failed for %s\n", dvd_path);
    return 1;
  }

  /* Prefer PGC-relative positioning for menus. */
  dvdnav_set_PGC_positioning_flag(nav, 1);
  dvdnav_set_readahead_flag(nav, 0);

  nav_state_t st;
  memset(&st, 0, sizeof(st));
  st.domain = DVD_DOMAIN_FirstPlay;
  st.cell = 1;
  st.pgn = 1;
  st.hl = 1;

  emit_pos("start", &st, NULL);

  FILE *fp = stdin;
  if (script_path) {
    fp = fopen(script_path, "r");
    if (!fp) {
      fprintf(stderr, "dvdnav-oracle play: cannot open script %s\n", script_path);
      dvdnav_close(nav);
      return 1;
    }
  }

  int rc = run_script(nav, &st, fp);
  if (script_path) fclose(fp);

  refresh_program(nav, &st);
  emit_pos("end", &st, NULL);
  dvdnav_close(nav);
  return rc == 0 ? 0 : 1;
}
