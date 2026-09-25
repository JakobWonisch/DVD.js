# AGENTS.md — DVD.js

Guidance for humans and coding agents working in this repo.

## Project goal

Preserve DVD menus for the future via a **convert-and-stream** pipeline (not full-ISO-in-browser):

- Server-side rip of decrypted `VIDEO_TS` / ISO → WebM + JSON/CSS/JS (+ stills)
- Browser player navigates still/motion menus, selects titles/chapters, plays video
- Clients never download the whole ISO

Architecture: **converter** (this checkout). Do not revive an on-the-fly/full-ISO-in-browser path as the primary product.

## Product constraints

- No client full-ISO load
- Featurettes not required; all video files + menu interaction are
- Gallery of menus comes later (same viewer + thumbnails)
- CSS/DRM ignored when a decrypted ISO/`VIDEO_TS` is available

## MVP success criteria

Given a decrypted disc: open in browser, navigate main menus (still + simple motion), select titles/chapters, play corresponding video — without downloading the ISO to the client.

## Priority work (build order)

1. **Package/seek model** — domain/PGC/cell (or sector→time) addressable segments
2. **Still menus** — PNG stills + infinite/N-second stills (`extractMenu` metadata-only today)
3. **VM completeness** — finish stubs in `src/vm/recompile.ts` (CallSS/resume, Link*, JumpSS FP, lang switch, …) — **TDD**
4. **SPU + highlight compositing** — beyond CSS rect hitboxes
5. **Cell/timing** — intro→interactive→loop, `hli_s_ptm`, still/`post()`
6. **D-pad / auto-activate** — `btnit` adjacency
7. **Hardening** — disc corpus QA

MVP cut: packaging → stills + clicks → VM/resume → (defer perfect SPU / exotic games).

## Engineering standards

- **Node ≥ 24**, **pnpm 12**, **TypeScript 7**, **Vitest 5**
- **ESM** — `"type": "module"`, `module`/`moduleResolution`: `NodeNext`, relative imports use `.js` extensions, `export default` / named `export`. No CommonJS `require()` in app code.
- Dynamic JSON: `loadJsonFile` (`src/server/utils/loadJson.ts`)
- Globs: Node `fs.glob` via `globFiles` (`src/server/utils/globFiles.ts`)
- CLI: `node:util.parseArgs` (convert entry)
- Config: `src/loadAppConfig.ts` loads `config/app.json` (from `config/app.example.json`)
- **pnpm settings** live in `pnpm-workspace.yaml` (`allowBuilds`, `minimumReleaseAgeExclude`) — not `package.json#pnpm`
- **Nix**: `flake.nix` `devShell` must stay reproducible (nodejs_24, pnpm, ffmpeg)
- **TDD for the VM** — fixture-driven tests under `tests/` before/with VM op implementations
- Optional later: libdvdnav (WASM or native at rip-time) for nav fidelity
- Avoid full VLC/OS-in-WASM as the starting approach
- Client `src/app/**` is legacy Backbone and excluded from `tsc` until a modern viewer lands
- Do **not** reintroduce Grunt, Bower, or TSD

## Key paths

| Area | Path |
|------|------|
| Rip pipeline | `src/server/convert/*` |
| App config | `src/loadAppConfig.ts`, `config/app.example.json` |
| VM → JS | `src/vm/recompile.ts` |
| Player | `src/player/index.ts` |
| Entry bins | `bin/convert.js`, `bin/http-server.js` |
| Tests | `tests/**/*.test.ts` |
| Docs | `README.md`, this file |

## Common commands

```bash
nix develop                 # optional; node, pnpm, ffmpeg
pnpm install                # or: npx pnpm@12.6.0 install
pnpm build                  # tsc → dist/
pnpm test
pnpm start                  # http://localhost:3000/
pnpm convert -- path/to/DVD/root
```

Copy `config/app.example.json` → `config/app.json` and set `webFolder` before convert/start.

## Agent habits

- Prefer small, reviewable changes aligned to the build order above
- When new durable preferences or patterns appear, **update this file**
- Do not commit unless explicitly asked
