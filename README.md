# DVD.js

Convert decrypted DVDs to a web-friendly package and play their menus in the browser — for interoperability and long-term menu preservation.

Clients never download the full ISO. The converter rips server-side and streams WebM + JSON/CSS/JS (+ stills).

> Historical talk (JS Conf 2014): [video](https://www.youtube.com/watch?v=lb-8euLqfRg) · [slides](https://gmarty.github.io/jsconf-2014-talk-play-dvd-in-js/)

## Status

This checkout continues the **converter** architecture (pre-rip + stream). The product focus is **menus**: default convert is menus-only; navigate still/motion menus with mouse and D-pad. JumpTT on a menu-only rip shows “title not included”. The browser UI is a **SolidJS** app under `viewer/` (Vite). Menu SPU select/activate overlays are baked at convert time. See `AGENTS.md` for goals and build order.

Requires a **decrypted** `VIDEO_TS` / ISO (CSS/DRM out of scope).

## Pipeline

Default convert is **menus only** (IFO/NAV/VM/buttons/stills + menu WebMs). Pass `--full` only if you also want title VOBs (optional).

1. IFO → JSON  
2. Chapters → WebVTT *(full mode only)*  
3. NAV packs → JSON  
4. Menu maps (all cells) + still PNGs + button CSS/adjacency  
5. VM commands → JavaScript (`vm.js`)  
6. VOB → WebM (ffmpeg): menu VOBs by default; title VOBs with `--full`

## Requirements

- **Node.js ≥ 24**
- **pnpm 12** (via Corepack, `npx pnpm@12.6.0`, or Nix)
- **ffmpeg** (for `pnpm convert`)
- On NixOS: `nix develop` provides Node, pnpm, and ffmpeg

## Quick start

```bash
# Optional on NixOS
nix develop

pnpm install          # if Corepack's pnpm is broken: npx pnpm@12.6.0 install
pnpm build

cp config/app.example.json config/app.json
# Set webFolder to a directory that will hold converted discs, e.g. /home/you/dvd/web
mkdir -p /home/you/dvd/web
```

Place a decrypted disc (folder containing `VIDEO_TS/`) somewhere, then convert:

```bash
# Menus only (default) — VIDEO_TS.VOB + VTS_*_0.VOB
pnpm convert -- /path/to/YourDisc

# Full rip including feature/extras title video
pnpm convert -- --full /path/to/YourDisc
```

Reencoding video is slow (especially `--full`). When finished:

```bash
pnpm start
```

Open [http://localhost:3000/](http://localhost:3000/).

### Config

| Key | Meaning |
|-----|---------|
| `webFolder` | Directory of converted DVD assets (served by the static server) |
| `staticServerPort` | HTTP port (default `3000`) |

`config/app.json` is gitignored; keep `config/app.example.json` as the template.

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm build` | Compile TypeScript (`tsc`) → `dist/` and Solid viewer → `dist/viewer/` |
| `pnpm build:viewer` | Vite build of `viewer/` only |
| `pnpm dev:viewer` | Vite HMR for the viewer (proxy disc assets from `:3000`) |
| `pnpm watch` | Rebuild server/convert on change |
| `pnpm start` | Serve `dist/viewer/` + `public/` + `webFolder` |
| `pnpm convert -- <dvd-root>` | Rip menus into `webFolder` (default) |
| `pnpm convert -- --full <dvd-root>` | Rip menus + title video |
| `pnpm convert -- --vm-only --web <disc>` | Regenerate `vm.js` from existing web JSON only |
| `pnpm test` | Vitest |
| `pnpm typecheck` | `tsc --noEmit` (server + viewer) |

## Tooling

| Piece | Choice |
|-------|--------|
| Package manager | pnpm 12 (`packageManager` in `package.json`) |
| Modules | ESM (`"type": "module"`, TypeScript `NodeNext` for server) |
| Compile | `tsc` (server/convert) + Vite/Solid (viewer) |
| Viewer | SolidJS + TypeScript under `viewer/` |
| Tests | Vitest 5 |
| Types | TypeScript 7 + `@types/*` |
| Nix | `flake.nix` → `devShell` with `nodejs_24`, `pnpm`, `ffmpeg` |
| pnpm policy | `pnpm-workspace.yaml` (`allowBuilds`, etc.) |

Entry points: `bin/convert.js`, `bin/http-server.js` (load `dist/`).

Legacy Backbone sources under `src/app/` and the old CDN `public/index.html` shell are superseded by the Solid viewer; `public/test.html` / `parse-ifo.html` remain as utilities.

## Browser support

Needs `<video>`, `<track>`, and WebVTT.

## FAQ

**Why not only re-encode the feature?**  
DVDs include menus, audio/subtitle selection, and interactive navigation. Preserving **menus** is the point. The default convert therefore rips **menus only**; `--full` is optional when you also want title playback. Play/JumpTT on a menu-only archive shows a short “title not included” message instead of breaking.

**Why not full ISO-in-browser / OS emulation?**  
Overkill for this product. Convert once, stream assets, drive navigation with converted VM/menu data (and optionally libdvdnav later).

**Do you need help?**  
Yes — issues and PRs welcome. Prefer changes aligned with the priority order in `AGENTS.md`.

## License

GPL-3.0 — see `LICENSE.txt`.
