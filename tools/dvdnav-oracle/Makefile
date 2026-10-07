# Build dvdnav-oracle (eval via vendored decoder.c + play via libdvdnav.so).
#
# Needs public dvdnav + dvdread headers and shared libs (Nix: `nix develop`).

ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
VENDOR := $(ROOT)vendor
BINDIR := $(ROOT)bin
TARGET := $(BINDIR)/dvdnav-oracle

CC ?= gcc
CFLAGS ?= -O2 -Wall -Wextra -Wno-unused-parameter

DVDNAV_INCLUDE ?= $(shell pkg-config --variable=includedir dvdnav 2>/dev/null)
DVDREAD_INCLUDE ?= $(shell pkg-config --variable=includedir dvdread 2>/dev/null)
DVDNAV_LIBDIR ?= $(shell pkg-config --variable=libdir dvdnav 2>/dev/null)
DVDREAD_LIBDIR ?= $(shell pkg-config --variable=libdir dvdread 2>/dev/null)

ifeq ($(DVDNAV_INCLUDE),)
  DVDNAV_INCLUDE := $(shell ls -d /nix/store/*-libdvdnav-*/include 2>/dev/null | head -1)
endif
ifeq ($(DVDREAD_INCLUDE),)
  DVDREAD_INCLUDE := $(shell ls -d /nix/store/*-libdvdread-*/include 2>/dev/null | head -1)
endif
ifeq ($(DVDNAV_LIBDIR),)
  DVDNAV_LIBDIR := $(shell ls -d /nix/store/*-libdvdnav-*/lib 2>/dev/null | head -1)
endif
ifeq ($(DVDREAD_LIBDIR),)
  DVDREAD_LIBDIR := $(shell ls -d /nix/store/*-libdvdread-*/lib 2>/dev/null | head -1)
endif

ifeq ($(DVDNAV_INCLUDE),)
  $(error Set DVDNAV_INCLUDE (or install libdvdnav + pkg-config))
endif
ifeq ($(DVDREAD_INCLUDE),)
  $(error Set DVDREAD_INCLUDE (or install libdvdread + pkg-config))
endif
ifeq ($(DVDNAV_LIBDIR),)
  $(error Set DVDNAV_LIBDIR)
endif
ifeq ($(DVDREAD_LIBDIR),)
  $(error Set DVDREAD_LIBDIR)
endif

INCLUDES := -I$(DVDNAV_INCLUDE) -I$(DVDREAD_INCLUDE) -I$(VENDOR)/src -I$(VENDOR)/src/vm
LIBS := -L$(DVDNAV_LIBDIR) -L$(DVDREAD_LIBDIR) -ldvdnav -ldvdread -lpthread
RPATH := -Wl,-rpath,$(DVDNAV_LIBDIR) -Wl,-rpath,$(DVDREAD_LIBDIR)

.PHONY: all clean check-headers

all: $(TARGET)

$(BINDIR):
	mkdir -p $(BINDIR)

$(TARGET): main.c play.c $(VENDOR)/src/vm/decoder.c | $(BINDIR) check-headers
	$(CC) $(CFLAGS) $(INCLUDES) -o $@ main.c play.c $(VENDOR)/src/vm/decoder.c $(LIBS) $(RPATH)

check-headers:
	@test -f "$(DVDNAV_INCLUDE)/dvdnav/dvdnav.h" || (echo "missing $(DVDNAV_INCLUDE)/dvdnav/dvdnav.h" >&2; exit 1)
	@test -f "$(DVDREAD_INCLUDE)/dvdread/ifo_types.h" || (echo "missing $(DVDREAD_INCLUDE)/dvdread/ifo_types.h" >&2; exit 1)

clean:
	rm -f $(TARGET)
