# AGENTS.md — DVD.js

Guidance for humans and coding agents working in this repo.

## Project goal

Preserve DVD menus for the future via a **convert-and-stream** pipeline (not full-ISO-in-browser):

- Server-side rip of `VIDEO_TS` / ISO (decrypt when needed) → WebM + JSON/CSS/JS (+ stills)
- Browser player navigates still/motion menus, selects titles/chapters, plays video
- Clients never download the whole ISO

Architecture: **converter** (this checkout). Do not revive an on-the-fly/full-ISO-in-browser path as the primary product.

## Product constraints

- No client full-ISO load
- Featurettes not required; menu interaction is
- Default convert is **menus only** (`VIDEO_TS.VOB` / `VTS_*_0.VOB`); `--full` encodes title VOBs too
- Title JumpTT / play on a menu-only rip must show a clear “not included” message (not a broken player)
- Catalogue thumbnail is one `cover.jpg` from the best VMGM menu still — **no menu gallery** (stored as `<discId>.cover.jpg` sidecar beside the archive)
- Converted discs are stored **compressed at rest** (`webFolder/<discId>.tar.gz`); the HTTP server decompresses on first play. Set `evictDiscCache: true` in config to drop decompressed folders after **1 hour** idle (default off for local/dev — extract once, keep around)
- Ideal UX: insert an optical disc (CSS-encrypted OK) → convert → playable web package; ship as Linux-first standalone CLI (Windows/macOS later)

## MVP success criteria

Given a disc (decrypted folder today; encrypted optical drive once the rip front-end lands) and **default menus-only** convert: open in browser, navigate main menus (still + simple motion) with mouse and D-pad — without downloading the ISO. JumpTT on missing titles shows a clear “not included” message. Title/`--full` export is optional and not required for a successful demo.

## Priority work (build order)

1. ~~**Package/seek model**~~ — multi-cell menu maps + sector→time on menu VOBs (done on `mvp-dpad`)
2. ~~**Still menus**~~ — PNG stills + `still_time` / `hli_s_ptm` / `post()` wiring (done)
3. ~~**VM runtime (menus)**~~ — opcode fixtures green; CallSS/`saveRSM` + `resumeRSM`, lang LU pick, cell play helpers (done)
4. ~~**D-pad / auto-activate**~~ — `btnit` adjacency + Arrow/Enter + CSS selected state (done)
5. ~~**SPU + highlight compositing**~~ — bake SPU PNG overlays + select/activate remap (done on `mvp-spu`)
6. **Hardening** — disc corpus QA; exotic menu games
7. **Standalone convert front-end** — Linux-first: setup script downloads main binary + ffmpeg + dvdbackup (ask keep-system vs ours); opt-in libdvdcss; `--rip` / `--rip-only` / `--keep-rip` / `--upload` stub; Windows/macOS later
8. **Optional `--full`** — title/chapter WebM fidelity (demoted; not MVP)

MVP cut (menus-first): packaging → stills + clicks + D-pad → VM/resume → SPU overlays → (defer exotic games / title export). Streamline rip + standalone CLI is next product work after hardening.

### Standalone converter app (ship later)

Ship the convert pipeline as a **standalone app** (CLI first; GUI optional later). **Linux is the priority** target; Windows and macOS are planned later with the same CLI surface.

#### Modes

| Mode | Default? | Behavior |
|------|----------|----------|
| **Convert** | yes | Source disc/folder/ISO → web package under `webFolder` (menus-only unless `--full`) |
| **Rip + keep work** | no | Decrypt/copy to a writable work dir and **leave** the `VIDEO_TS` tree for iterative re-converts (`--vm-only`, still re-extract, etc.) |
| **Upload** | no | After convert, push the menu package to a media server (stub today — see `upload.ts`) |

Default path: insert disc (or omit the path when a single optical drive is present) → convert straight to our format. Rip-to-workdir (`--keep-rip` / `--rip-only`) is for debugging and iteration. Upload is a post-convert hook, not part of the browser player.

Suggested CLI shape (implement incrementally):

```bash
# Default: sole optical drive (/dev/sr0, …); errors if none or several
pnpm convert --

# Explicit VIDEO_TS folder / mount (in place, no copy)
pnpm convert -- /path/to/DVD

# Explicit device / ISO (rips via dvdbackup; --rip is optional for these)
pnpm convert -- /dev/sr0
pnpm convert -- --work-dir ~/dvd/work /dev/sr0

# Rip ISO/disc to a work dir and stop (or keep after convert)
pnpm convert -- --rip-only --work-dir ~/dvd/work /dev/sr0
pnpm convert -- --keep-rip --work-dir ~/dvd/work /dev/sr0   # convert + leave rip

# Future: upload converted package (stub — empty header only)
pnpm convert -- --upload /path/to/already-converted-or-source
```

#### Where CSS decryption sits

**Only on the rip stage.** Convert/ffmpeg/upload never speak CSS.

```
[optical / encrypted ISO] --libdvdcss+dvdbackup--> [writable VIDEO_TS]
                                                      |
                                                      +--> convert → webFolder package
                                                      +--> optional --keep-rip / --rip-only
                                                      +--> optional --upload (web package only)
```

- Already-decrypted folder: skip rip; convert reads files directly.
- Optical device / ISO: convert **auto-rips** via **dvdbackup** (libdvdread + libdvdcss) into a temp work dir (or `--work-dir`). `--rip` / `--rip-only` / `--keep-rip` remain for explicit control.
- No path: use the sole `/dev/sr*` (Linux); error if zero or multiple drives — pass an explicit path then.
- Upload: HTTP(S) of the **converted** menu tree — no disc access, no libdvdcss.
- Do not reimplement CSS; shell out (or later spawn a bundled helper) to `dvdbackup`.

#### Platforms

| Platform | Status | Native rip deps |
|----------|--------|-----------------|
| **Linux** | Priority — ship first | `ffmpeg`, `dvdbackup`, `libdvdread`, `libdvdcss` (Nix `devShell` already lists them) |
| **Windows** | Later | Same CLI; bundle or document equivalents (e.g. ffmpeg + a dvdbackup/libdvdcss build). Optical device paths differ (`D:\` vs `/dev/sr0`). |
| **macOS** | Later | Same CLI; Homebrew/`nix` for deps; `/dev/disk*` / mounted volumes. |

Keep Node convert code **OS-agnostic** (paths via `node:path`, spawn helpers by name). Isolate platform differences in a thin `ripDisc` helper (device path detection, binary lookup). Ship Linux packages first (Nix flake / AppImage / deb later); dual-build Windows/macOS only after the Linux CLI is solid.

**Legal note:** shipping or bundling CSS circumvention (libdvdcss) is restricted in some jurisdictions. Prefer documenting system deps on Linux first; treat bundling as an explicit packaging decision per region, and never put decrypt code in the browser/viewer.

#### Packaging (final plan): setup script + separate binaries

Users should **not** install Node or pnpm. Distribution is a **setup script** (Linux first; Windows/macOS later) that downloads components separately — not one fat AppImage that embeds everything.

A pure “Node SEA / `bun compile` file” is still the **main binary**; convert shells out to **ffmpeg** and **dvdbackup** (and optionally **libdvdcss**).

##### License / redistribution (not legal advice)

| Component | Software license | Our stance |
|-----------|------------------|------------|
| **Main converter binary** | GPL-3.0 (this project) | Hosted on our releases; setup downloads it |
| **ffmpeg** | LGPL/GPL | OK to host and download; include licenses + source offer |
| **dvdbackup** (+ **libdvdread** as needed) | GPL | OK to host and download as sidecars |
| **libdvdcss** | GPL copyright OK; **anti-circumvention risk** | **Opt-in only** — setup *offers* to download; never required for decrypted folders |

##### Setup flow

```
curl -fsSL https://…/install.sh | sh    # or download install.sh
# → detect OS/arch (Linux amd64 first)
# → for each of: main binary, ffmpeg, dvdbackup:
#      if found on PATH (or known system path):
#        ask: keep system version, or download ours?
#      else:
#        download ours into ~/.local/share/dvdjs/bin (checksum-verified)
# → offer libdvdcss: "Download libdvdcss for encrypted retail discs? [y/N]"
#      if yes and not already present: download or point at system lib
# → write ~/.config/dvdjs/tools.json  # resolved paths + versions
# → symlink/wrapper on PATH: dvdjs-convert
```

Runtime resolution order (documented in `tools.json`):

1. Paths chosen at setup (ours under `~/.local/share/dvdjs/…` or user-kept system paths)
2. Never silently prefer an unexpected PATH binary over the setup choice

```
dvdjs-convert setup          # re-run prompts / refresh downloads
dvdjs-convert /dev/sr0       # convert using tools.json paths
```

**Viewer:** optional later (`serve` subcommand or separate download). Converter CLI is the priority.

**Windows / macOS:** same setup script contract; different download URLs and path layout when those targets land.

### Optional: libdvdnav (not required for MVP)

**Stay optional.** The recompiled `vm.js` path already covers menus for the MVP. Pull in libdvdnav only if corpus QA keeps hitting nav bugs the hand-ported VM cannot fix cleanly.

- **Rip-time (native, preferred if needed):** use libdvdnav as an oracle while converting — validate jumps, cell order, CallSS/RSM, and exotic menu games against a known-good engine; optionally dump ground-truth nav traces for fixtures. Fits convert-and-stream; no browser WASM tax.
- **Browser WASM (last resort):** drive menus from libdvdnav’s state machine instead of `vm.js`. Higher fidelity, heavier, and fights the “pre-rip + stream” model — only if rip-time checks prove the JS VM is the bottleneck.
- Opcode fixtures already treat libdvdnav (`decoder.c` / `vmcmd.c`) as the reference; that stays true without shipping the library.

### ffmpeg / readonly source discs

~~Older two-pass libvpx wrote `ffmpeg2pass*` under the DVD root (fails on optical / readonly mounts).~~ Fixed: `encodeVideo` is **single-pass**; stills use `os.tmpdir()`. Convert must keep **all** writes under `webFolder` or tmp — never beside source VOBs.

## Engineering standards

- **Node ≥ 24**, **pnpm 12**, **TypeScript 7**, **Vitest 5**
- **ESM** — `"type": "module"`, `module`/`moduleResolution`: `NodeNext`, relative imports use `.js` extensions, `export default` / named `export`. No CommonJS `require()` in app code.
- Dynamic JSON: `loadJsonFile` (`src/server/utils/loadJson.ts`)
- Globs: Node `fs.glob` via `globFiles` (`src/server/utils/globFiles.ts`)
- CLI: `node:util.parseArgs` (convert entry)
- Config: `src/loadAppConfig.ts` loads `config/app.json` (from `config/app.example.json`)
- **pnpm settings** live in `pnpm-workspace.yaml` (`allowBuilds`, `minimumReleaseAgeExclude`) — not `package.json#pnpm`
- **Nix**: `flake.nix` `devShell` stays reproducible (`nodejs_24`, `pnpm`, **`ffmpeg-full`** with libdvdread/libdvdnav, `libdvdcss`, `libdvdread`, `libdvdnav`, `dvdbackup`). Plain `ffmpeg` disables DVD CSS demux — do not switch back.
- **TDD for the VM** — fixture-driven tests under `tests/` before/with VM op implementations
- libdvdnav remains **optional** (see above); prefer rip-time oracle over browser WASM if pulled in
- Avoid full VLC/OS-in-WASM as the starting approach
- Browser viewer is **SolidJS + TypeScript** under `viewer/` (Vite → `dist/viewer/`). Legacy Backbone `src/app/**` is unused and still excluded from server `tsc`
- Do **not** reintroduce Grunt, Bower, or TSD
- Convert writes only under `webFolder` / tmp (never to optical / readonly source trees)

## Key paths

| Area | Path |
|------|------|
| Rip pipeline | `src/server/convert/*` |
| Disc archive / cache | `src/server/discCache.ts` (pack `.tar.gz`, ensure/extract; optional 1h TTL via `evictDiscCache`) |
| Rip / decrypt stub | `src/server/convert/ripDisc.ts` |
| Upload stub | `src/server/convert/upload.ts` |
| App config | `src/loadAppConfig.ts`, `config/app.example.json` |
| VM → JS | `src/vm/recompile.ts` |
| Player host | `viewer/src/host/*` (native `x-video` / `x-menu`) |
| Solid viewer | `viewer/` |
| Entry bins | `bin/convert.js`, `bin/http-server.js` |
| Tests | `tests/**/*.test.ts` |
| Docs | `README.md`, this file |

Solid custom elements: set `data-*` with `attr:data-*={...}` (property binding does not create attributes, so generated button CSS selectors like `[data-domain="0"] …` would miss).

`generateMenuCellTable` merges into existing `menuCell` entries (preserves `css` / `buttons` / SPU from later convert steps when stills are re-run alone).

Menu button CSS and SPU frame height use `resolveMenuFrameHeight` (`menuFrameHeight.ts`): IFO **menu** `video_format` (VMGM/VTSM → PAL 576 / NTSC 480), never title `vts_video_attr` (can disagree). Falls back to PCI button `y_end` when menu attrs are missing.

Menu convert pitfalls (LOTR-class discs):
- Iterate `menu_c_adt.cell_adr_table.length`, not `nr_of_vobs` — `nr_of_vobs` counts unique VOB IDs; multi-cell VOBs make the table longer and trailing cells (buttons/SPU/stills) get skipped otherwise.
- Emit `MPGCIUT` entries even when `command_tbl` is null — interactive menus often have only PCI button cmds; skipping them makes `linkPGC` after a transition clip a dead end.
- Cell `startSec`/`endSec` for the menu WebM must follow **C_ADT sector order** (`buildMenuCellTimingMap`), not per-PGC relative times (single-cell PGCs would all look like `startSec: 0`).
## Common commands

```bash
nix develop                 # optional; node, pnpm, ffmpeg, dvdbackup/libdvdcss
pnpm install                # or: npx pnpm@12.6.0 install
pnpm build                  # tsc → dist/ + Solid viewer → dist/viewer/
pnpm dev:viewer             # Vite HMR (proxies disc assets to :3000)
pnpm test
pnpm start                  # http://localhost:3000/
pnpm convert --                        # sole optical drive (errors if 0 or many)
pnpm convert -- path/to/DVD/root          # menus only (default)
pnpm convert -- --full path/to/DVD/root   # menus + titles
pnpm convert -- --vm-only --web discName  # regenerate vm.js only
```

Copy `config/app.example.json` → `config/app.json` and set `webFolder` before convert/start.

Convert writes `extractMode: "menus" | "full"` into per-title metadata entries. Menu-only archives keep Jump* in `vm.js`; the viewer host (`viewer/src/host`) surfaces a message when title media is absent.

## Agent habits

- Prefer small, reviewable changes aligned to the build order above
- When new durable preferences or patterns appear, **update this file**
- Do not commit unless explicitly asked
