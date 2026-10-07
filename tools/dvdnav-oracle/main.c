/*
 * dvdnav-oracle — evaluate DVD VM commands with libdvdnav's decoder.
 *
 * Compiles libdvdnav 6.1.1 src/vm/decoder.c (vendored) against public
 * dvdnav/dvdread headers. Does not link libdvdnav.so — only needs headers
 * for vm_cmd_t / includes.
 *
 * Usage:
 *   dvdnav-oracle eval --cmd HEX [--cmd HEX ...] [--gprm v0,...] [--sprm v0,...]
 *
 * Prints one JSON object to stdout.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <inttypes.h>
#include <ctype.h>

#include <dvdread/ifo_types.h> /* vm_cmd_t */

#include "decoder.h"

#define MAX_CMDS 64

static const char *link_cmd_name(link_cmd_t cmd) {
  switch (cmd) {
    case LinkNoLink: return "LinkNoLink";
    case LinkTopC: return "LinkTopC";
    case LinkNextC: return "LinkNextC";
    case LinkPrevC: return "LinkPrevC";
    case LinkTopPG: return "LinkTopPG";
    case LinkNextPG: return "LinkNextPG";
    case LinkPrevPG: return "LinkPrevPG";
    case LinkTopPGC: return "LinkTopPGC";
    case LinkNextPGC: return "LinkNextPGC";
    case LinkPrevPGC: return "LinkPrevPGC";
    case LinkGoUpPGC: return "LinkGoUpPGC";
    case LinkTailPGC: return "LinkTailPGC";
    case LinkRSM: return "LinkRSM";
    case LinkPGCN: return "LinkPGCN";
    case LinkPTTN: return "LinkPTTN";
    case LinkPGN: return "LinkPGN";
    case LinkCN: return "LinkCN";
    case Exit: return "Exit";
    case JumpTT: return "JumpTT";
    case JumpVTS_TT: return "JumpVTS_TT";
    case JumpVTS_PTT: return "JumpVTS_PTT";
    case JumpSS_FP: return "JumpSS_FP";
    case JumpSS_VMGM_MENU: return "JumpSS_VMGM_MENU";
    case JumpSS_VTSM: return "JumpSS_VTSM";
    case JumpSS_VMGM_PGC: return "JumpSS_VMGM_PGC";
    case CallSS_FP: return "CallSS_FP";
    case CallSS_VMGM_MENU: return "CallSS_VMGM_MENU";
    case CallSS_VTSM: return "CallSS_VTSM";
    case CallSS_VMGM_PGC: return "CallSS_VMGM_PGC";
    case PlayThis: return "PlayThis";
    default: return "Unknown";
  }
}

static int parse_hex_byte(const char *s, uint8_t *out) {
  if (!isxdigit((unsigned char)s[0]) || !isxdigit((unsigned char)s[1])) {
    return -1;
  }
  unsigned int v = 0;
  if (sscanf(s, "%2x", &v) != 1) {
    return -1;
  }
  *out = (uint8_t)v;
  return 0;
}

static int parse_cmd_hex(const char *hex, vm_cmd_t *cmd) {
  size_t len = strlen(hex);
  if (len != 16) {
    fprintf(stderr, "dvdnav-oracle: --cmd expects 16 hex chars (8 bytes), got %zu\n", len);
    return -1;
  }
  for (int i = 0; i < 8; i++) {
    if (parse_hex_byte(hex + i * 2, &cmd->bytes[i]) != 0) {
      fprintf(stderr, "dvdnav-oracle: invalid hex in --cmd\n");
      return -1;
    }
  }
  return 0;
}

static int parse_u16_list(const char *s, uint16_t *out, int n) {
  const char *p = s;
  for (int i = 0; i < n; i++) {
    char *end = NULL;
    unsigned long v = strtoul(p, &end, 0);
    if (end == p || v > 0xffff) {
      fprintf(stderr, "dvdnav-oracle: bad u16 list at index %d\n", i);
      return -1;
    }
    out[i] = (uint16_t)v;
    if (i + 1 < n) {
      if (*end != ',') {
        fprintf(stderr, "dvdnav-oracle: expected comma after u16 index %d\n", i);
        return -1;
      }
      p = end + 1;
    } else if (*end != '\0') {
      fprintf(stderr, "dvdnav-oracle: trailing junk in u16 list\n");
      return -1;
    }
  }
  return 0;
}

static int parse_u8_list(const char *s, uint8_t *out, int n) {
  const char *p = s;
  for (int i = 0; i < n; i++) {
    char *end = NULL;
    unsigned long v = strtoul(p, &end, 0);
    if (end == p || v > 0xff) {
      fprintf(stderr, "dvdnav-oracle: bad u8 list at index %d\n", i);
      return -1;
    }
    out[i] = (uint8_t)v;
    if (i + 1 < n) {
      if (*end != ',') {
        fprintf(stderr, "dvdnav-oracle: expected comma after u8 index %d\n", i);
        return -1;
      }
      p = end + 1;
    } else if (*end != '\0') {
      fprintf(stderr, "dvdnav-oracle: trailing junk in u8 list\n");
      return -1;
    }
  }
  return 0;
}

static void print_u16_array(const uint16_t *a, int n) {
  printf("[");
  for (int i = 0; i < n; i++) {
    if (i) printf(",");
    printf("%u", (unsigned)a[i]);
  }
  printf("]");
}

static void print_u8_array(const uint8_t *a, int n) {
  printf("[");
  for (int i = 0; i < n; i++) {
    if (i) printf(",");
    printf("%u", (unsigned)a[i]);
  }
  printf("]");
}

/**
 * Apply the HL_BTNN side-effect that libdvdnav's process_command performs
 * when consuming a link that carries a button number. vmEval_CMD itself does
 * not write SPRM[8]; our recompiled JS does. Normalize here so register
 * diffs are comparable.
 */
static void apply_link_button_highlight(registers_t *regs, const link_t *link) {
  uint16_t button = 0;
  switch (link->command) {
    case LinkNoLink:
    case LinkTopC:
    case LinkNextC:
    case LinkPrevC:
    case LinkTopPG:
    case LinkNextPG:
    case LinkPrevPG:
    case LinkTopPGC:
    case LinkNextPGC:
    case LinkPrevPGC:
    case LinkGoUpPGC:
    case LinkTailPGC:
    case LinkRSM:
      button = link->data1;
      break;
    case LinkPTTN:
    case LinkPGN:
    case LinkCN:
      button = link->data2;
      break;
    default:
      return;
  }
  if (button != 0) {
    regs->SPRM[8] = (uint16_t)(button << 10);
  }
}

static void usage(void) {
  fprintf(stderr,
    "Usage: dvdnav-oracle eval --cmd HEX16 [--cmd HEX16 ...] [--gprm v0,..] [--sprm v0,..] [--gprm-mode v0,..]\n"
    "  HEX16 = 8 command bytes as 16 hex digits (e.g. 3002000000010000 for JumpTT 1)\n"
  );
}

static int cmd_eval(int argc, char **argv) {
  vm_cmd_t commands[MAX_CMDS];
  int ncmds = 0;
  registers_t regs;
  link_t link;
  const char *gprm_arg = NULL;
  const char *sprm_arg = NULL;
  const char *mode_arg = NULL;
  int normalize_hl = 1;

  memset(&regs, 0, sizeof(regs));
  memset(&link, 0, sizeof(link));
  memset(commands, 0, sizeof(commands));

  for (int i = 0; i < argc; i++) {
    if (strcmp(argv[i], "--cmd") == 0) {
      if (i + 1 >= argc || ncmds >= MAX_CMDS) {
        fprintf(stderr, "dvdnav-oracle: --cmd needs a value (max %d cmds)\n", MAX_CMDS);
        return 2;
      }
      if (parse_cmd_hex(argv[++i], &commands[ncmds]) != 0) {
        return 2;
      }
      ncmds++;
    } else if (strcmp(argv[i], "--gprm") == 0) {
      if (i + 1 >= argc) { usage(); return 2; }
      gprm_arg = argv[++i];
    } else if (strcmp(argv[i], "--sprm") == 0) {
      if (i + 1 >= argc) { usage(); return 2; }
      sprm_arg = argv[++i];
    } else if (strcmp(argv[i], "--gprm-mode") == 0) {
      if (i + 1 >= argc) { usage(); return 2; }
      mode_arg = argv[++i];
    } else if (strcmp(argv[i], "--no-normalize-hl") == 0) {
      normalize_hl = 0;
    } else {
      fprintf(stderr, "dvdnav-oracle: unknown arg %s\n", argv[i]);
      usage();
      return 2;
    }
  }

  if (ncmds == 0) {
    usage();
    return 2;
  }

  if (gprm_arg && parse_u16_list(gprm_arg, regs.GPRM, 16) != 0) return 2;
  if (sprm_arg && parse_u16_list(sprm_arg, regs.SPRM, 24) != 0) return 2;
  if (mode_arg && parse_u8_list(mode_arg, regs.GPRM_mode, 16) != 0) return 2;

  int32_t jumped = vmEval_CMD(commands, ncmds, &regs, &link);
  if (jumped && normalize_hl) {
    apply_link_button_highlight(&regs, &link);
  }

  printf("{");
  printf("\"jumped\":%s,", jumped ? "true" : "false");
  printf("\"gprm\":");
  print_u16_array(regs.GPRM, 16);
  printf(",\"sprm\":");
  print_u16_array(regs.SPRM, 24);
  printf(",\"gprm_mode\":");
  print_u8_array(regs.GPRM_mode, 16);
  if (jumped) {
    printf(",\"link\":{");
    printf("\"command\":%d,", (int)link.command);
    printf("\"name\":\"%s\",", link_cmd_name(link.command));
    printf("\"data1\":%u,", (unsigned)link.data1);
    printf("\"data2\":%u,", (unsigned)link.data2);
    printf("\"data3\":%u", (unsigned)link.data3);
    printf("}");
  } else {
    printf(",\"link\":null");
  }
  printf("}\n");
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    usage();
    return 2;
  }
  if (strcmp(argv[1], "eval") == 0) {
    return cmd_eval(argc - 2, argv + 2);
  }
  if (strcmp(argv[1], "--help") == 0 || strcmp(argv[1], "-h") == 0) {
    usage();
    return 0;
  }
  fprintf(stderr, "dvdnav-oracle: unknown command '%s' (try eval)\n", argv[1]);
  usage();
  return 2;
}
