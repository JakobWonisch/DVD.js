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
- Featurettes not required; menu interaction is
- Default convert is **menus only** (`VIDEO_TS.VOB` / `VTS_*_0.VOB`); `--full` encodes title VOBs too
- Title JumpTT / play on a menu-only rip must show a clear “not included” message (not a broken player)
- Gallery of menus comes later (same viewer + thumbnails)
- CSS/DRM ignored when a decrypted ISO/`VIDEO_TS` is available

## MVP success criteria

Given a decrypted disc and **default menus-only** convert: open in browser, navigate main menus (still + simple motion) with mouse and D-pad — without downloading the ISO. JumpTT on missing titles shows a clear “not included” message. Title/`--full` export is optional and not required for a successful demo.

## Priority work (build order)

1. ~~**Package/seek model**~~ — multi-cell menu maps + sector→time on menu VOBs (done on `mvp-dpad`)
2. ~~**Still menus**~~ — PNG stills + `still_time` / `hli_s_ptm` / `post()` wiring (done)
3. ~~**VM runtime (menus)**~~ — opcode fixtures green; CallSS/`saveRSM` + `resumeRSM`, lang LU pick, cell play helpers (done)
4. ~~**D-pad / auto-activate**~~ — `btnit` adjacency + Arrow/Enter + CSS selected state (done)
5. ~~**SPU + highlight compositing**~~ — bake SPU PNG overlays + select/activate remap (done on `mvp-spu`)
6. **Hardening** — disc corpus QA; exotic menu games
7. **Optional `--full`** — title/chapter WebM fidelity (demoted; not MVP)

MVP cut (menus-first): packaging → stills + clicks + D-pad → VM/resume → SPU overlays → (defer exotic games / title export).

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
- Browser viewer is **SolidJS + TypeScript** under `viewer/` (Vite → `dist/viewer/`). Legacy Backbone `src/app/**` is unused and still excluded from server `tsc`
- Do **not** reintroduce Grunt, Bower, or TSD

## Key paths

| Area | Path |
|------|------|
| Rip pipeline | `src/server/convert/*` |
| App config | `src/loadAppConfig.ts`, `config/app.example.json` |
| VM → JS | `src/vm/recompile.ts` |
| Player host | `viewer/src/host/*` (native `x-video` / `x-menu`) |
| Solid viewer | `viewer/` |
| Entry bins | `bin/convert.js`, `bin/http-server.js` |
| Tests | `tests/**/*.test.ts` |
| Docs | `README.md`, this file |

Solid custom elements: set `data-*` with `attr:data-*={...}` (property binding does not create attributes, so generated button CSS selectors like `[data-domain="0"] …` would miss).

`generateMenuCellTable` merges into existing `menuCell` entries (preserves `css` / `buttons` / SPU from later convert steps when stills are re-run alone).
## Common commands

```bash
nix develop                 # optional; node, pnpm, ffmpeg
pnpm install                # or: npx pnpm@12.6.0 install
pnpm build                  # tsc → dist/ + Solid viewer → dist/viewer/
pnpm dev:viewer             # Vite HMR (proxies disc assets to :3000)
pnpm test
pnpm start                  # http://localhost:3000/
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
