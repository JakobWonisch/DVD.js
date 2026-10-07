# Build the single-command libdvdnav VM oracle.
#
# Needs public dvdnav + dvdread headers (Nix: `nix develop`, or set
# DVDNAV_INCLUDE / DVDREAD_INCLUDE). Does not link libdvdnav.so — we compile
# vendored decoder.c from libdvdnav 6.1.1 (see vendor/VERSION).

ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
VENDOR := $(ROOT)vendor
BINDIR := $(ROOT)bin
TARGET := $(BINDIR)/dvdnav-oracle

CC ?= gcc
CFLAGS ?= -O2 -Wall -Wextra -Wno-unused-parameter

# Prefer pkg-config; fall back to explicit dirs or common Nix store paths.
DVDNAV_INCLUDE ?= $(shell pkg-config --variable=includedir dvdnav 2>/dev/null)
DVDREAD_INCLUDE ?= $(shell pkg-config --variable=includedir dvdread 2>/dev/null)

ifeq ($(DVDNAV_INCLUDE),)
  DVDNAV_INCLUDE := $(shell ls -d /nix/store/*-libdvdnav-*/include 2>/dev/null | head -1)
endif
ifeq ($(DVDREAD_INCLUDE),)
  DVDREAD_INCLUDE := $(shell ls -d /nix/store/*-libdvdread-*/include 2>/dev/null | head -1)
endif

ifeq ($(DVDNAV_INCLUDE),)
  $(error Set DVDNAV_INCLUDE to the directory containing dvdnav/dvdnav.h (or install libdvdnav + pkg-config))
endif
ifeq ($(DVDREAD_INCLUDE),)
  $(error Set DVDREAD_INCLUDE to the directory containing dvdread/ifo_types.h (or install libdvdread + pkg-config))
endif

INCLUDES := -I$(DVDNAV_INCLUDE) -I$(DVDREAD_INCLUDE) -I$(VENDOR)/src -I$(VENDOR)/src/vm

.PHONY: all clean check-headers

all: $(TARGET)

$(BINDIR):
	mkdir -p $(BINDIR)

$(TARGET): main.c $(VENDOR)/src/vm/decoder.c | $(BINDIR) check-headers
	$(CC) $(CFLAGS) $(INCLUDES) -o $@ main.c $(VENDOR)/src/vm/decoder.c

check-headers:
	@test -f "$(DVDNAV_INCLUDE)/dvdnav/dvdnav.h" || (echo "missing $(DVDNAV_INCLUDE)/dvdnav/dvdnav.h" >&2; exit 1)
	@test -f "$(DVDREAD_INCLUDE)/dvdread/ifo_types.h" || (echo "missing $(DVDREAD_INCLUDE)/dvdread/ifo_types.h" >&2; exit 1)

clean:
	rm -f $(TARGET)
