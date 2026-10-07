# Nav oracle findings (Part 3)

Disc-path compare: native `dvdnav-oracle play` vs headless `vm.js` replay on shared `.navscript` files. Settled positions = `compareTraces` snapshots after `pump` / `still` / `pos` / `end` (cell chatter collapsed).

Re-run:

```bash
pnpm nav-oracle -- \
  --video-ts dvds/Shrek/VIDEO_TS \
  --web web/Shrek/vm.js \
  --script tests/vm/oracle/scripts/shrek-smoke.navscript

pnpm nav-oracle -- \
  --video-ts "dvds/Harry Potter Philosophers Ston/VIDEO_TS" \
  --web web/Harry_Potter_Philosophers_Ston/vm.js \
  --script tests/vm/oracle/scripts/harry-potter-smoke.navscript
```

Status legend: **fixed** | open

---

## Shrek (`shrek-smoke.navscript`)

Smoke: First Play → first interactive still → activate button 1 → VTS menu.

| ID | Status | Finding |
|----|--------|---------|
| S1 | **fixed** | FP path briefly enters title VTS_05 then returns to VMGM Title menu. Headless replay used to stop in title (no `post()`), so settled space was `title` vs gold `menu`. Replay now drains short title PGCs via `playTitleCell` / `playByID` → `post()`, matching libdvdnav. |
| S2 | **fixed** | After activate, gold often sits on cell 1 while ours drains a buttonless intro cell into cell 2 of the same menu. `compareTraces` treats same `space/vts/pgc/hl` as one menu (soft cell). |
| S3 | **fixed** | Interactive motion menus (`buttons.length > 0`, finite or zero `still_time`) must settle like infinite stills — do not auto-`onPost` (LinkPGN loops). Replay `playMenuCell` emits `still=255` and waits for activate. |

**Result (after fixes):** `OK — settled positions match` (gold≈menu vts=0 pgc=1; after activate≈menu vts=1 pgc=1).

---

## Harry Potter (`harry-potter-smoke.navscript`)

Smoke: pump until WAIT on VTSM main menu → activate 1 → expect title play.

| ID | Status | Finding |
|----|--------|---------|
| H1 | **fixed** | Product bug: JumpSS/CallSS recompile indexed `MPGCIUT[0][lang]` / `MENU_TYPES[…][lang]` with SPRM lang `"en"` while VMGM LUs are only `"default"`. Throws `Cannot read properties of undefined (reading '2')` on CallSS VMGM PGC. Fix: emit `lang = pickLang(0)\|\|lang` (VTSM: `pickLang(domain)\|\|pickLang(0)\|\|lang`) before menu table access in `src/vm/recompile.ts`. Regenerate affected `vm.js` (`pnpm convert -- --vm-only --web …`). Eval harness stubs `pickLang` in `runJsCommand.ts`. |
| H2 | **fixed** | After H1, activate JumpTTs into the feature (title pgc 1). Replay treated long titles like short clips and immediately ran `post()` → CallSS into VMGM PGC2 and drained dozens of `still_time=10` cells (28 settled positions vs gold’s 2). Fix: headless `playTitlePgc` / `playByID` **hold** feature-length PGCs (no auto-post); script can `still_skip` later. Short title PGCs (warnings, FP bumpers) still post. |
| H3 | open | Gold title cell after activate is often `cell=2` (VTS_CHANGE timing); ours reports `cell=1`. Soft cell rule already accepts this when space/vts/pgc/hl match — noted only, not a product bug. |
| H4 | open | Navscript `pump … until=wait` relies on libdvdnav WAIT; replay approximates with `still=255` on motion menus. Settled menu position matches; event names differ (`wait` vs `still`). |

**Result (after H1–H2):** `OK — settled positions match` (menu vts=1 pgc=1 cell=2 → title vts=1 pgc=1).

---

## Cross-cutting harness notes

| ID | Status | Note |
|----|--------|------|
| X1 | **fixed** | Only settle infinite stills (`still_time===255`) or button-bearing menus; finite stills auto-post (DVD: play then hold then post). |
| X2 | **fixed** | `playTitlePgc` must run PGC `post()` for **short** titles so FP/warning chains continue (Shrek S1); must **not** for long titles (Harry Potter H2). |
| X3 | open | Replay `pump` ignores `until=` and only flushes sync timers — fine while scripts stop on still/title hold; weaker for scripts that expect mid-stream event cuts. |

---

## Regenerating corpus `vm.js`

`pnpm convert -- --vm-only --web <discId>` packs into `<discId>.tar.gz` and removes the extracted folder. For local oracle runs, re-extract:

```bash
tar -xzf web/Shrek.tar.gz -C web
tar -xzf web/Harry_Potter_Philosophers_Ston.tar.gz -C web
```
