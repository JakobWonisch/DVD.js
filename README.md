# DVD.js

Convert decrypted DVDs to a web-friendly package and play their menus in the browser — for interoperability and long-term menu preservation.

Clients never download the full ISO. The converter rips server-side and streams WebM + JSON/CSS/JS (and eventually stills).

> Historical talk (JS Conf 2014): [video](https://www.youtube.com/watch?v=lb-8euLqfRg) · [slides](https://gmarty.github.io/jsconf-2014-talk-play-dvd-in-js/)

## Status

This checkout continues the **converter** architecture (pre-rip + stream). It is a strong prototype, not a finished commercial-menu player: basic discs can work; still menus, full VM coverage, and SPU compositing are incomplete. See `AGENTS.md` for goals and build order.

Requires a **decrypted** `VIDEO_TS` / ISO (CSS/DRM out of scope).

## Pipeline

1. IFO → JSON  
2. Chapters → WebVTT  
3. NAV packs → JSON  
4. Button hitboxes → CSS  
5. Menu still frames → PNG *(to be done)*  
6. VM commands → JavaScript  
7. VOB → WebM (ffmpeg)

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
pnpm convert -- /path/to/YourDisc
```

Reencoding video is slow. When finished:

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
| `pnpm build` | Compile TypeScript (`tsc`) → `dist/` |
| `pnpm watch` | Rebuild on change |
| `pnpm start` | Serve `public/` + `webFolder` |
| `pnpm convert -- <dvd-root>` | Rip a disc into `webFolder` |
| `pnpm test` | Vitest |
| `pnpm typecheck` | `tsc --noEmit` |

## Tooling

| Piece | Choice |
|-------|--------|
| Package manager | pnpm 12 (`packageManager` in `package.json`) |
| Modules | ESM (`"type": "module"`, TypeScript `NodeNext`) |
| Compile | `tsc` only (no Grunt / Bower / TSD) |
| Tests | Vitest 5 |
| Types | TypeScript 7 + `@types/*` |
| Nix | `flake.nix` → `devShell` with `nodejs_24`, `pnpm`, `ffmpeg` |
| pnpm policy | `pnpm-workspace.yaml` (`allowBuilds`, etc.) |

Entry points: `bin/convert.js`, `bin/http-server.js` (load `dist/`).

The browser catalogue UI under `src/app/` is still legacy and not part of the `tsc` build yet.

## Browser support

Needs `<video>`, `<track>`, and WebVTT.

## FAQ

**Why not only re-encode the feature?**  
DVDs include menus, audio/subtitle selection, and interactive navigation. Preserving that is the point.

**Why not full ISO-in-browser / OS emulation?**  
Overkill for this product. Convert once, stream assets, drive navigation with converted VM/menu data (and optionally libdvdnav later).

**Do you need help?**  
Yes — issues and PRs welcome. Prefer changes aligned with the priority order in `AGENTS.md`.

## License

GPL-3.0 — see `LICENSE.txt`.
