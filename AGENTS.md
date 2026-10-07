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
- Default convert is **menus + short title cells** (`VIDEO_TS.VOB` / `VTS_*_0.VOB`, plus title cells whose **VOB NAV PTS duration** is ≤ **60s** and that belong to a fully-short title PGC — games / brief interactive extras, even inside a feature VTS); `--full` encodes all title VOBs. Cap: `TITLE_INCLUDE_MAX_SEC` (`titleIncludePolicy.ts` / `titleCellSegments.ts`). Long feature/documentary/commentary PGCs stay omitted; JumpTT to those PGCs uses **title stubs** (`titlePgcMedia.stubs` via `generateTitleStubs`): **skip** = silent PGC `post()` (no dialog), **interactive** = still PNG + end-of-title HLI buttons when the omitted PGC has PCI buttons. Legacy archives without stubs still show “not included” (`guardTitleJump` + `playTitlePgc`)
- Title JumpTT / play on a menu-only rip must show a clear “not included” message (not a broken player). Menu-button JumpTT is guarded before leaving the cell (`dvd.guardTitleJump`); OK restores the exact prior menu/VM snapshot (existing archives without the guard still snapshot-at-button and restore on dismiss — never jump to VMGM Title)
- Catalogue thumbnail is one `cover.jpg` from the **main-menu** still (VMGM Title → Root → other Title; within that PGC prefer infinite/timed still over intro cells) — **no menu gallery** (stored as `<discId>.cover.jpg` sidecar beside the archive). Falls back to largest usable VMGM still when metadata has no Title/Root match (`pickCoverStill.ts`)
- Converted discs are stored **compressed at rest** (`webFolder/<discId>.tar.gz`); the HTTP server decompresses on first play. Set `evictDiscCache: true` in config to drop decompressed folders after **1 hour** idle (default off for local/dev — extract once, keep around)
- Pack writes `.dvd-menu-archive-converting` for the convert lifetime and verifies `metadata.json` (and `vm.js`) in the new `.tar.gz` **before** deleting the unpacked folder; `metadata.json`/`vm.js` are archived first. Pack **renames** the folder away before `rm` so ensure cannot report ready on a tree about to vanish. Markers older than `CONVERTING_STALE_MS` (12h) are cleared as crashed converts. Ensure/extract must not `rm` a converting tree (that race produced archives missing metadata when the HTTP server unpacked over a live reconvert). Legacy `.dvdjs-*` marker names are still recognized.
- Host/vm properties stay `_dvdjs*` (e.g. `_dvdjsVmInited`, `_dvdjsActiveMenu`) so existing generated `vm.js` archives keep working. New public identifiers use `dvd-menu-archive` / `DVD_MENU_ARCHIVE_*`.
- Ideal UX: insert an optical disc (CSS-encrypted OK) → convert → playable web package; ship as Linux-first standalone CLI (Windows/macOS later)

## MVP success criteria

Given a disc (decrypted folder today; encrypted optical drive once the rip front-end lands) and **default** convert (menus + title cells ≤ 60s by VOB PTS): open in browser, navigate main menus (still + simple motion) with mouse and D-pad — without downloading the ISO. JumpTT on omitted (long) titles uses skip/interactive stubs when convert metadata has them; legacy archives still show a clear “not included” message. `--full` title export is optional and not required for a successful demo.

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
#        download ours into ~/.local/share/dvd-menu-archive/bin (checksum-verified)
# → offer libdvdcss: "Download libdvdcss for encrypted retail discs? [y/N]"
#      if yes and not already present: download or point at system lib
# → write ~/.config/dvd-menu-archive/tools.json  # resolved paths + versions
# → symlink/wrapper on PATH: dvd-menu-archive
```

Runtime resolution order (documented in `tools.json`):

1. Paths chosen at setup (ours under `~/.local/share/dvd-menu-archive/…` or user-kept system paths)
2. Never silently prefer an unexpected PATH binary over the setup choice

```
dvd-menu-archive setup          # re-run prompts / refresh downloads
dvd-menu-archive /dev/sr0       # convert using tools.json paths
```

**Viewer:** optional later (`serve` subcommand or separate download). Converter CLI is the priority.

**Windows / macOS:** same setup script contract; different download URLs and path layout when those targets land.

### Optional: libdvdnav (not required for MVP)

**Stay optional.** The recompiled `vm.js` path already covers menus for the MVP. Pull in libdvdnav only if corpus QA keeps hitting nav bugs the hand-ported VM cannot fix cleanly.

- **Single-command eval oracle (implemented):** `tools/dvdnav-oracle/` vendors libdvdnav **6.1.1** `decoder.c` and builds a CLI that runs `vmEval_CMD`. Compare register + link effects against `recompile()` in a stub host via `pnpm test:vm-oracle` (needs headers from the Nix `devShell`). See `tools/dvdnav-oracle/README.md`.
- **Rip-time disc-path oracle (planned):** drive native libdvdnav on a real `VIDEO_TS` with a scripted button stream, dump nav traces, replay against converted `vm.js`. Fits convert-and-stream; no browser WASM tax.
- **Browser WASM (last resort):** drive menus from libdvdnav’s state machine instead of `vm.js`. Higher fidelity, heavier, and fights the “pre-rip + stream” model — only if rip-time checks prove the JS VM is the bottleneck.
- Opcode fixtures already treat libdvdnav (`decoder.c` / `vmcmd.c`) as the reference for **compile** expects; the eval oracle checks **runtime** parity.

### ffmpeg / readonly source discs

~~Older two-pass libvpx wrote `ffmpeg2pass*` under the DVD root (fails on optical / readonly mounts).~~ Fixed: `encodeVideo` is **single-pass**; stills use `os.tmpdir()`. Convert must keep **all** writes under `webFolder` or tmp — never beside source VOBs.

### WebM encode / no NVIDIA GPU acceleration

Menu and title video stay **WebM + libvpx (VP8) + Vorbis** (`encodeVideo`). That keeps a royalty-free progressive `<video>` package for Chromium/Firefox and matches the convert → serve → viewer contract (paths, per-cell menu WebMs, metadata).

**NVIDIA NVENC does not encode VP8/VP9**, so convert cannot “just use the GPU” for the current codec. Encode is CPU-only today. Realistic GPU paths would need a deliberate format change:

| Approach | Notes |
|----------|--------|
| Keep WebM + libvpx | Status quo; no NVENC |
| WebM + `av1_nvenc` | Possible on Ada / 40-series+; needs NVENC-capable ffmpeg + viewer acceptance |
| NVDEC decode only (`mpeg2_cuvid` / `-hwaccel cuda`) | May speed demux of MPEG-2; encode still libvpx |
| MP4 + `h264_nvenc` | Fastest common GPU path; breaks WebM package / Safari-unrelated assumptions |

Prefer documenting this over inventing a silent HW path. Menus-only converts are usually short; GPU matters most for `--full`. Do not switch away from WebM without an explicit product decision.

### Color normalize / tag (stills + WebM)

DVD MPEG-2 is **BT.601 limited (TV) range**. Untagged limited WebM often looks darker in Chrome (HW decode); untagged PNG stills can look darker in Firefox (CMS) vs VLC. Convert expands TV→PC and tags output via `dvdColorConvert.ts`:

- Filter: `yadif` + `colorspace=iall=smpte170m|bt470bg:all=bt709:irange=tv:range=pc` (NTSC/PAL from IFO `video_format`; menus use VMGM/VTSM, titles use `vts_video_attr`)
- Metadata: `-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range pc`
- Applied to menu/title WebM (`encodeVideo`), menu stills (`generateMenuCellTable`), and title-stub stills (`generateTitleStubs`)

## Engineering standards

- **Node ≥ 24**, **pnpm 12**, **TypeScript 7**, **Vitest 5**
- **ESM** — `"type": "module"`, `module`/`moduleResolution`: `NodeNext`, relative imports use `.js` extensions, `export default` / named `export`. No CommonJS `require()` in app code.
- Dynamic JSON: `loadJsonFile` (`src/server/utils/loadJson.ts`)
- Globs: Node `fs.glob` via `globFiles` (`src/server/utils/globFiles.ts`)
- CLI: `node:util.parseArgs` (convert entry)
- Config: `src/loadAppConfig.ts` — `config/app.json` and/or env (`DVD_MENU_ARCHIVE_*`; legacy `DVDJS_*` accepted); Docker Compose uses env + volume for `webFolder`
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
| Title stubs (menus mode) | `src/server/convert/titleStubs.ts`, `generateTitleStubs.ts`; viewer `viewer/src/host/titleStubs.ts` + `dvdHost.playTitlePgc` |
| Disc archive / cache | `src/server/discCache.ts` (pack `.tar.gz` with verify + converting guard; ensure/extract; reextract when archive mtime is newer than `.dvd-menu-archive-archive-mtime`; optional 1h TTL via `evictDiscCache`) |
| Rip / decrypt stub | `src/server/convert/ripDisc.ts` |
| Upload stub | `src/server/convert/upload.ts` |
| App config | `src/loadAppConfig.ts`, `config/app.example.json`, `.env.example` |
| Docker (HTTP) | `Dockerfile`, `compose.yaml` — serve-only; convert on host |
| VM → JS | `src/vm/recompile.ts` |
| Player host | `viewer/src/host/*` (native `x-video` / `x-menu`) |
| Solid viewer | `viewer/` |
| Entry bins | `bin/convert.js`, `bin/http-server.js` |
| Tests | `tests/**/*.test.ts` |
| VM eval oracle | `tools/dvdnav-oracle/` + `tests/vm/oracle/` (`pnpm test:vm-oracle`) |
| Docs | `README.md`, this file |

Solid custom elements: set `data-*` with `attr:data-*={...}` (property binding does not create attributes, so generated button CSS selectors like `[data-domain="0"] …` would miss).

Menu button hitboxes: convert stores geometry on each `buttons[].css` (`left/top/width/height` %). The viewer applies those **inline** (and stamps from the linked `menu-*.css` sheet by `data-id` as a fallback for older archives). Do not rely only on attribute-scoped stylesheet rules — when `data-cell`/`data-vob` drift from the sheet (multi-cell PGCs), hitboxes otherwise collapse to the top-left and only keyboard nav still works.

`generateMenuCellTable` merges into existing `menuCell` entries (preserves `css` / `buttons` / SPU from later convert steps when stills are re-run alone).

Menu button CSS and SPU frame height use `resolveMenuFrameHeight` (`menuFrameHeight.ts`): IFO **menu** `video_format` (VMGM/VTSM → PAL 576 / NTSC 480), never title `vts_video_attr` (can disagree). Falls back to PCI button `y_end` when menu attrs are missing.

Menu stills (`generateMenuCellTable`): seek to the authored highlight frame — skip to the HLI VOBU (`btn_ns` / `hli_s_ptm` from NAV) and decode **one** frame at that PTS (not “largest of N”). No-HLI timed stills use the **first** frame of the cell (never mid-sector — short copyright cells are often padding after VOBU 0). Pure transitions (no buttons + `still_time` 0) omit the still. When extraction fails (or the cell is tiny), write a **gray placeholder PNG** labeled with `domain-cell-vob` via `writeStillPlaceholder` so the viewer never 404s on `menu-*.png`. **Clip the cell byte range to a temp VOB before ffmpeg** (same `capMenuEncodeEndBytes` as encode — absurd C_ADT spans must not `Buffer.alloc` the rest of the VOB). Short cells that sit against the next VOB (Harry Potter last scene page → Special Features) otherwise bleed and pick the wrong still. Buttons / SPU / `btnCmd` share `pickHighlightNav` (not cell-start-only NAV). NAV extract follows `vobu_sri.next_vobu` and **resumes at the next C_ADT cell start** on gaps (do not abandon the rest of the VOB).

Menu WebM encode (`encodeVideo`): **one WebM per menu cell** (`menu-{domain}-{cell}-{vob}.webm`), same naming as stills. Clip each cell's byte range to a temp VOB, encode that cell's video + audio (silence if none), stamp `menuCell[].video`. Cap clip bytes from duration when C_ADT `last_sector` spans the rest of the VOB for a tiny playback_time (Shrek VMGM cell 1:3). Still/short cells often have only one MPEG frame — pad with `tpad=stop_mode=clone` up to IFO duration. Never mux audio from a whole menu VOB (pairs English a:0 under later German cells). Mux with `apad`+`-shortest` so Vorbis overrun cannot inflate clip length. Viewer plays each cell clip from **t=0**. **No domain concat** (`VIDEO_TS.webm` / `VTS_*_0.webm`) — if a cell fails, skip it and clear stale `video` stamps; if there are no menuCell segments, skip menu VOB encode (still PNGs only). Button HLI enable uses convert-time `hliDelaySec` (cell-local PTS). After encode, convert regenerates `vm.js` so `playMenuCell` gets `video:` URLs.

Viewer motion→still handoff: **keep a painted layer at all times**. Use a host `canvas.dvd-menu-archive-menu-hold` snapshot of the last good video/still frame *before* seeking or hiding the WebM — never blank both video and still (that is the black flash). Prefer the hold canvas over a previous cell’s cached `menu-*.png`. Reveal order: next layer ready → show it → then hide hold/video. Silent-refresh the hold bitmap near segment end / on motion reveal (`captureMenuHoldFrame(..., { show: false })`) so the next handoff has pixels. When deferring still install, keep `img.menu-still` at `opacity:0` until its `src` is the *target* cell and has pixels. Do not hide video/still on a blind timeout. After a transition clip, `play()` may resolve late and set still `opacity:0` on the *next* cell — only hide the still while that motion segment is still the active `_dvdjsFinishMenuSegment` (plus `_dvdjsMenuPlayGen`). Cancel prior motion/seek/meta listeners at every `playMenuCell` entry. Menu WebMs must not loop (`loop=false`). Finish motion via `motionSegmentFinishAt` (~250ms early on long cells) + **rAF end-poll** (not only sparse `timeupdate`) and **pause+mute without seeking** (`freezeMenuVideoAtEnd`) — overshoot into the next concat cell causes a wipe-end audio/frame flicker (Harry Potter transitions). Mute while seek-covered (`play(..., { startMuted: true })`); unmute only on reveal with volume=0 then a ~50ms linear fade-in (`fadeInVideoAudio`) to soften cell-boundary clicks. If `ended` / overrun past `endSec`, hide the video and show the hold canvas. On motion entry, capture hold from stage then hide WebM until `currentTime` is inside the segment; retry reveal until in-segment. Start the motion watchdog only after an in-segment `currentTime`, budgeted from **segment duration** (`end - start`), never `end - currentTime` when past the cell (0.2s floor would auto-finish and cascade PGC `onPost`). Do not call `video.load()` while preloading or while `networkState` is already loading. **`still_time === 255` is still-only** (do not play as motion) — short infinite-still pages (Harry Potter scene selection) would otherwise finish → `onPost` → auto-advance every page to the main menu. After real motion, hold forever only when `still_time === 255` (`scheduleMenuPostAfterStill` must no-op on 255); **buttons + `still_time` 0 must still run `onPost`** so cellCmds/PGC post can replay the segment (Harry Potter main menu loop). Convert skips still extraction for pure transitions (no buttons + `still_time` 0) via `cellNeedsStillPng`.

Title play after First Play: `fp_pgc` uses `setTimeout`, so unmuted `video.play()` is often blocked — use `playWithAutoplayFallback` for `playByID` / `playTitleCell`. Hide the menu-hold canvas before showing a title WebM (hold is absolute and covered the DreamWorks logo). When returning to a menu, **hide all title `<video>`s** (`display:none` + `hidden`) — they sit later in the DOM at z-index 1 and otherwise leave a frozen black end-frame over language selection (Shrek FP → VTS_05 → Title menu). Cold disc mounts must not start every title WebM + menu still at once — `DvdDisc` uses `preload="none"` / `loading="lazy"`, and `playByID` calls `prioritizeTitleVideo` + `whenVideoReadyForPlay` with a stall watchdog (Lotr_See_D4 FP → `VTS_12_1.webm` otherwise hung black until a warm reload).

Viewer menu click: `loadVm` calls `init()` once and sets `_dvdjsVmInited`; `startVm` must not call `init()` again — older vm.js stacked click listeners, so after host/`btnCmd` rebuilt the menu the next handler hit `target.parentNode === null` (Harry Potter Special Features B0). Host `bindMenuKeys` click stops immediate propagation after a successful activate; generated click handler null-checks `parentNode`.

Virtual remote (touch D-pad): player toolbar checkbox “Virtual remote” toggles a semi-transparent ↑←●→↓ overlay (bottom-center of the **video surface**, including fullscreen). Preference persists in `localStorage` (`dvd-menu-archive-virtual-remote`). Available on all viewports when enabled — not mobile-only. Presses go through `handleMenuNavAction` (same path as Arrow/Enter).

Player layout: `.player-stage` wraps `.player-surface` (DVD aspect box: video + start overlay + spinner + virtual remote + decompress/status) and `.player-toolbar` below it. Overlays never cover the toolbar; while any surface overlay/load is active the toolbar is `player-toolbar--locked` (controls `disabled` / non-interactive).

Viewer console debug (black-screen / extract QA): toolbar “Console debug”, `?dvd-menu-archive-debug=1`, or `localStorage["dvd-menu-archive-debug"]=1`. Logs ensure status, metadata/vm load, `playMenuCell` path (motion vs still), WebM/still HEAD probes, video errors, reveal/finish/watchdog. Prefix `[dvd-menu-archive:…]`. Off by default.

Title stub buttons: convert emits `btnCmd`/`btnNav` under `[domain]["stub"][pgc]` (not menu cell/vob IDs). The viewer stub menu sets `data-vob="stub"` / `data-cell={pgc}` so clicks never wipe Main Menu commands when stub cell/vob would collide with `1:1`.

Viewer safety net / loading / reports: menu motion already finishes on WebM `error` / metadata watchdog; still handoff that never gets pixels **auto-advances** when the cell would have posted anyway (timed still, or `still_time` 0 with no buttons) via `recoverAfterMediaFailure` (finish → `onPost` → main menu). Infinite stills (255) keep the hold frame for user input. A small bottom-left spinner on the video surface (`mediaLoadState`) shows while the next still/WebM is loading; WebM may show buffered %. Toolbar **Report a problem** POSTs the always-on session ring buffer (`sessionLog.ts`, independent of console debug) to `POST /api/reports`. Caps: `reportsMaxCount` (100), `reportsMaxTotalBytes` (50MB), `reportsMaxBodyBytes` (512KB), plus per-IP rate limit — full storage returns **507** `storage_full` and the button shows that reason. Files land in `reportsFolder` (default `<webFolder>/.dvd-menu-archive-reports`).

Copyright / take-down: site-wide banner (hidden on `/play/:dvdId`) + footer/nav link to `/#/copyright`. Contact fields live in `viewer/src/copyrightContact.ts` (replace placeholders before public launch). Page follows DMCA §512 notice elements; U.S. safe-harbor also needs Copyright Office agent registration + 3-year renewal.

`window.dvd` binding: vm.js uses bare `dvd`. Never `delete window.dvd` on dispose — that makes later `init` / leaked `keydown` throw `ReferenceError: dvd is not defined` after a prior disc (hard refresh / revisit). Dispose swaps in a stub and removes `_dvdjsKeyHandler`; `loadVm` binds `window.dvd` before appending the script and cache-busts `vm.js`.

Menu `pgN` / `cellN`: flattened menu cells use the same 1-based index. `playCurrentMenuCell` onPost (transition → still) and `LinkNextC` must keep `pgN = cellN`. Otherwise `LinkNextPG` (`pgN += 1; cellN = pgN`) needs two presses to leave Special Features (Harry Potter Cast & Crew). Viewer patches older vm.js via `patchPlayCurrentMenuCellPgN`.

Title-domain `LinkPGN` / `LinkCN` (Shrek trivia answer clips): `playCurrentMenuCell` must **not** force `pgcSpace = "menu"` — when already in title space it calls `playCurrentTitleCell` → `dvd.playTitleCell` with remapped WebM `[startSec,endSec)` from `titlePgcMedia.pgcCells`. Forcing menu space lands on a buttonless `still_time` 255 still and sticks. Cell cmds after the clip (often LinkTailPGC → menu) run via onPost.

Menu cell commands: run from `playCurrentMenuCell` onPost via `cellCmds[cell_cmd_nr - 1]` (DVD `play_Cell_post`), **not** at PGC `run()` start. Calling `cell()` immediately after `playCurrentMenuCell()` skips shared transition clips (Harry Potter Scene Selection / Languages flash black; Special Features only worked because its `pre()` returned early). Emit `cell_cmd_nr` on each cell and `cellCmds` as a per-entry function array. `LinkTailPGC` must `return 1` after `post()` so onPost does not also auto-advance.

Menu convert pitfalls (LOTR-class discs):
- Iterate `menu_c_adt.cell_adr_table.length`, not `nr_of_vobs` — `nr_of_vobs` counts unique VOB IDs; multi-cell VOBs make the table longer and trailing cells (buttons/SPU/stills) get skipped otherwise.
- Emit `MPGCIUT` entries even when `command_tbl` is null — interactive menus often have only PCI button cmds; skipping them makes `linkPGC` after a transition clip a dead end.
- Cell `startSec`/`endSec` for the menu WebM must follow **C_ADT sector order** (`buildMenuCellTimingMap`), not per-PGC relative times (single-cell PGCs would all look like `startSec: 0`).
- Index `btnCmd`/`btnNav` as `[domain][vob_id][cell_id][btn]` — never vob-only. Harry Potter reuses one `vob_id` across cells with different button counts/commands; a later cell would wipe Main Menu (`linkPGC`) on Special Features.

VM recompile pitfalls (Harry-Potter-class title pre):
- Printable 16-bit immediates (ISO-639 `0x6465` = `"de"`) must emit as `0x6465 /* "de" */` — never `0x6465 ("de")` (JS call → `25701 is not a function`).
- SPRM 16/18 (`AUD_LANG` / `SPU_LANG`) need non-empty abbr keys and runtime init (packed `0x656E` for `"en"`); empty `sprm[""]` breaks language preference compares in title `pre`.
- Menu languages: host toolbar switcher is **hidden for now** (external LU picks confused some discs); `menuLanguage.ts` / `setMenuLanguage` stay for resume later. Auto-pick still uses `localStorage` `dvd-menu-archive.menuLang` → **en** → first (`pickMenuLang` / `loadVm`). Single-LU discs with an on-disc language screen (Avatar EUR) need no host switcher. Switching (when re-enabled) sets `g.lang` + `sprm.MENU_LANG` and jumps to main menu. Menu PGC `run()` must not blindly re-`pickLang` when current `lang` exists for that domain. Unspecified DVD LU `lang_code` `0xFFFF` (bit2str `ÿÿ`) is normalized to **`default`** at convert (`ifoMenuLangCode`) and in the viewer (`normalizeMenuLangCode` / `aliasUnspecifiedMenuLangs` for older archives).

- Menus-only missing-title auto-skip / title `post()` / Main menu: `bridgeMenuLangBuckets` aliases missing LU keys across domains on load (The Thief Lord: VMGM `default` ↔ VTS `en`/`nl`/`de`) so JumpSS/CallSS with one global `lang` does not throw. `runTitlePgcPostWithLangFallback` still retries title-domain then VMGM langs on TypeError; `runMenu` / `escapeToVmgmTitleMenu` use the same bridge (VMGM Title trampolines that JumpSS into VTS Root).

Copyright / FBI warning cells (Avatar-class): often a short VMGM cell with `still_time` 1–5s whose **post JumpTTs into title VOBs** (not the next menu still). Treat language copyrights as **still-only** when `still_time ≥ 3`, duration ≤ 1.5s, no buttons (`menuCellPrefersStillOnly`) — show the PNG for the full hold (do not play the sub-second MPEG as motion). After that post sets the UI language cookie (`gprm[0x0B]`, DE/FR/NL), call `afterLanguageCopyrightPost` to open the VTS1 language-dispatcher Root instead of the studio-logo / Angle JumpTT hub — and never `clearTimeout(t)` after the dispatcher (that cancels the `linkPGC` into the translated menu). Menus-only rips must also auto-skip missing titles via PGC `post()`, with **cycle detection** (PGC9 ↔ missing title loops) falling back to the dispatcher when the cookie is set, else the **VMGM Title** menu (`MENU_TYPES[0][lang][2]`, domain forced to 0) — not the current VTS Root (Avatar domain-5 Root is an empty stub that JumpTTs straight back into PGC9). Latch the break so further missing titles do not `post()` again. Motion cells must honor `still_time` **after** the segment ends (DVD: play, then hold last frame, then post) — do not ignore timed stills on the motion path. Tiny copyright cells (~12KB) must still attempt still extraction (`MIN_CELL_BYTES` is low enough); do not request `-spu.png` when a cell has no buttons.
## Common commands

```bash
nix develop                 # optional; node, pnpm, ffmpeg, dvdbackup/libdvdcss
pnpm install                # or: npx pnpm@12.6.0 install
pnpm build                  # tsc → dist/ + Solid viewer → dist/viewer/
pnpm start                  # http://localhost:3000/ + rebuild viewer on change
pnpm start:server           # HTTP only (no viewer watch)
pnpm dev:viewer             # Vite HMR on :5173 (proxies disc assets; run with start:server)
pnpm test
pnpm build:dvdnav-oracle && pnpm test:vm-oracle  # libdvdnav eval vs recompile
pnpm convert --                        # sole optical drive (errors if 0 or many)
pnpm convert -- path/to/DVD/root          # menus + short title cells ≤ 60s
pnpm convert -- --full path/to/DVD/root   # menus + all titles
pnpm convert -- --vm-only --web discName  # regenerate vm.js only
pnpm reconvert                            # pick from dvds/*/VIDEO_TS (empty=all, 1,2=include, !1=exclude)
pnpm reconvert -- --full "1,3"            # non-interactive; convert flags before selection
pnpm reconvert -- --catalogue-only        # rewrite webFolder/dvds.json only
```

Ripped sources for `reconvert` default to `dvds/` (`DVD_MENU_ARCHIVE_RIPS` or `--rips` to override).

Copy `config/app.example.json` → `config/app.json` and set `webFolder` before convert/start.

Docker host: `docker compose up -d --build` serves `dist/viewer` + mounted `webFolder` (`DVD_MENU_ARCHIVE_WEB_VOLUME`). Set `DVD_MENU_ARCHIVE_UID`/`DVD_MENU_ARCHIVE_GID` to the host owner of that volume (`id -u` / `id -g`) — the image user `10001` cannot write typical bind mounts, which breaks archive extract / ensure. Convert remains a host/CLI concern (ffmpeg); do not put optical/CSS decrypt in the browser image.

Convert writes `extractMode: "menus" | "full"` into per-title metadata entries. Menu-mode archives keep Jump* in `vm.js` and may include short title WebMs (≤ `TITLE_INCLUDE_MAX_SEC`); the viewer host (`viewer/src/host`) surfaces a message when title media is absent.

## Agent habits

- Prefer small, reviewable changes aligned to the build order above
- When new durable preferences or patterns appear, **update this file**
- Do not commit unless explicitly asked
