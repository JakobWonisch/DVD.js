# dvdnav-oracle

Single-command (and short-sequence) **eval oracle** using libdvdnav’s VM decoder (`vmEval_CMD` from `src/vm/decoder.c`).

This is **Option A** from the nav-oracle plan: we vendor libdvdnav **6.1.1** decoder sources and compile them against public `dvdnav` / `dvdread` headers. The shared library is not linked; only headers are required.

## Build

```bash
# From repo root (Nix: headers via devShell)
nix develop -c pnpm build:dvdnav-oracle

# Or manually
make -C tools/dvdnav-oracle
```

Binary: `tools/dvdnav-oracle/bin/dvdnav-oracle` (gitignored).

Requires:

- `gcc` / `make`
- Headers: `dvdnav/dvdnav.h`, `dvdread/ifo_types.h` (Nix `libdvdnav` + `libdvdread`, or system packages)

## Usage

```bash
./tools/dvdnav-oracle/bin/dvdnav-oracle eval --cmd 3002000000010000
# JumpTT title 1 → JSON with gprm/sprm/link

./tools/dvdnav-oracle/bin/dvdnav-oracle eval \
  --cmd 7100000000010000 \
  --gprm 10,3,7,0,0,0,0,0,0,0,0,0,0,0,0,0
```

Output shape:

```json
{
  "jumped": true,
  "gprm": […16…],
  "sprm": […24…],
  "gprm_mode": […16…],
  "link": { "command": 22, "name": "JumpTT", "data1": 1, "data2": 0, "data3": 0 }
}
```

`--no-normalize-hl` disables applying the button→`SPRM[8]` side-effect that libdvdnav’s `process_command` normally performs after eval (enabled by default so register diffs match recompiled JS).

## Tests

```bash
pnpm build:dvdnav-oracle
pnpm test:vm-oracle
```

Compares each `status: 'ok'` opcode fixture’s **runtime effect** (registers + link) under libdvdnav vs `recompile()` executed in a stub host.

## Vendor notice

Files under `vendor/` are from [libdvdnav 6.1.1](https://www.videolan.org/developers/libdvdnav.html) (GPL-2.0-or-later), same family as this project’s GPL-3.0 license. See `vendor/VERSION`.
