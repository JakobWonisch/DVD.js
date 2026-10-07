# dvdnav-oracle

libdvdnav-backed oracles for DVD.js VM parity.

| Mode | What | Needs |
|------|------|--------|
| **eval** | Single-command `vmEval_CMD` (vendored `decoder.c`) | Headers only |
| **play** | Disc-path JSONL traces via `libdvdnav.so` | Headers + shared libs |

## Build

```bash
nix develop -c pnpm build:dvdnav-oracle
# or: make -C tools/dvdnav-oracle
```

Binary: `tools/dvdnav-oracle/bin/dvdnav-oracle` (gitignored).

Requires `gcc`, `make`, `libdvdnav` + `libdvdread` (Nix `devShell`).

## eval (Part 2)

```bash
./tools/dvdnav-oracle/bin/dvdnav-oracle eval --cmd 3002000000010000
```

Prints one JSON object: `gprm` / `sprm` / `link` after `vmEval_CMD`.

```bash
pnpm test:vm-oracle   # builds + Vitest opcode effect suite
```

## play (Part 3)

Drive a real `VIDEO_TS` with a `.navscript`, emit JSONL position events:

```bash
./tools/dvdnav-oracle/bin/dvdnav-oracle play \
  --path dvds/Shrek \
  --script tests/vm/oracle/scripts/shrek-smoke.navscript
```

### Navscript

```
# comment
pump max=80000 until=still
snapshot
activate 1
pump max=80000 until=still|stop
snapshot
select down
activate
still_skip
menu root
```

| Op | Meaning |
|----|---------|
| `pump max=N until=still\|wait\|stop\|cell\|highlight\|hop\|menu` | Read blocks until event |
| `snapshot` | Emit current position |
| `activate [N]` | Activate button N (1-based) or current |
| `select up\|down\|left\|right` | Move highlight |
| `select_button N` | Select without activate |
| `still_skip` / `wait_skip` | Skip still/wait |
| `menu title\|root\|…` | `dvdnav_menu_call` |

Finite stills auto-skip during pump; infinite stills (`255`) stop the pump so the script can `activate` / `still_skip`. Buttonless `WAIT` (VOBU sync) always auto-skips; only waits with PCI buttons settle when `until` includes `wait`.

### Compare vs converted package

```bash
pnpm nav-oracle -- \
  --video-ts dvds/Shrek \
  --web web/Shrek/vm.js \
  --script tests/vm/oracle/scripts/shrek-smoke.navscript
```

### Menu-graph explore

BFS every interactive menu screen (libdvdnav), activate each button, compare
destinations to headless `vm.js`. Titles are recorded as destinations but not
expanded. Each path is replayed from a cold start.

```bash
pnpm nav-oracle -- --video-ts dvds/Shrek --web web/Shrek/vm.js --explore
pnpm nav-oracle -- --video-ts dvds/Shrek --web web/Shrek/vm.js --explore \
  --max-screens 48 --max-depth 8 --json
```

Still/wait JSONL events include `"buttons":N` (PCI `btn_ns`) for explore.

Vitest (`tests/vm/oracle/navOracle.test.ts`) runs the Shrek smoke when `dvds/Shrek` + `web/Shrek/vm.js` exist (or `DVDJS_NAV_*` env). Default smoke checks that both sides produce traces; set `DVDJS_NAV_STRICT=1` to require settled-position equality. Set `DVDJS_NAV_EXPLORE=1` for the full menu-graph test (slower). Shrek + Harry Potter smokes match after harness + JumpSS/`pickLang` fixes — see `tests/vm/oracle/NAV_ORACLE_FINDINGS.md`.

## Vendor notice

`vendor/` holds libdvdnav **6.1.1** decoder sources for **eval** (GPL-2.0-or-later). **play** links the system/Nix `libdvdnav.so`. See `vendor/VERSION` + `NOTICE`.
