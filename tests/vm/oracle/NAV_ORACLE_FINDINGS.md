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

## Lotr See D1 (`lotr-see-d1-smoke.navscript`)

Smoke: First Play → first interactive still → activate button 1.

| ID | Status | Finding |
|----|--------|---------|
| L1 | open | First settled menu disagrees: gold=`menu vts=0 pgc=11 cell=1`, ours=`menu vts=0 pgc=2 cell=2`. Trace shows both pass title VTS_03 then VMGM pgc=2 cell=2; libdvdnav then hits WAIT and lands on pgc=11 still=255, while headless replay settles on pgc=2 (metadata: vob1/cell2 `still_time=255`, 4 buttons — harness holds). |
| L2 | open (soft) | After activate, both reach the same place: `title vts=1 pgc=1` (gold via hop pgc=4; ours via menu pgc=4 then title). So button-1 JumpTT from the early menu matches the later menu’s outcome for this smoke — first-menu PGC mismatch is still a real nav divergence. |

**Result:** settled-position **DIFF** on pos[0] (pgc 11≠2); pos[1] title matches.

```bash
pnpm nav-oracle -- \
  --video-ts "dvds/Lotr See D1/VIDEO_TS" \
  --web web/Lotr_See_D1/vm.js \
  --script tests/vm/oracle/scripts/lotr-see-d1-smoke.navscript
```

---

## Avatar Bk1 Vol1 Eur (`avatar-vol1-smoke.navscript`)

Smoke: First Play → first interactive still → activate button 1.

| ID | Status | Finding |
|----|--------|---------|
| A1 | open (corpus) | **Gold cannot finish:** rip is menus-skewed / incomplete — `VIDEO_TS` has `VTS_03_0.IFO` but **no** `VTS_03_*.VOB` (also no `VTS_04` menu/title VOBs). After FP timed still, libdvdnav dies: `Error opening vtsN=3, domain=3`. Partial gold: start → VMGM still_timed=2 → crash. |
| A2 | open | **Ours alone (no gold):** FP settles briefly on `menu vts=0 pgc=2 still=2`, then posts into `title vts=4 pgc=2` (gold would have entered VTS_03). Activate on title has no `btnCmd` → harness `still_skip` → `title vts=5 pgc=4` cell1↔2 loop until stack overflow (`Maximum call stack size exceeded`). Related to Avatar-class language-copyright / missing-title auto-skip (AGENTS.md) plus incomplete title media in this rip. |

**Result:** compare **blocked** (gold play exits 1). Need fuller VIDEO_TS or oracle soft-fail when a VTS VOB is missing.

```bash
pnpm nav-oracle -- \
  --video-ts "dvds/Avatar Bk1 Vol1 Eur/VIDEO_TS" \
  --web web/Avatar_Bk1_Vol1_Eur/vm.js \
  --script tests/vm/oracle/scripts/avatar-vol1-smoke.navscript
```

---

## Avatar Bk1 Vol3 Eur (`avatar-vol3-smoke.navscript`)

Smoke: First Play → first interactive still → activate button 1.

| ID | Status | Finding |
|----|--------|---------|
| A3 | open | First settled menu: gold=`menu vts=0 pgc=3 cell=1 hl=2`, ours=`menu vts=0 pgc=2 cell=1 hl=1`. Gold FP path: timed still → title VTS_02 → VMGM pgc=3 (hl=2). Ours: finite still on pgc=2 posts into **title vts=5** and settles there for the first `pump`/`snapshot` (never reaches pgc=3 language/menu still). Same class as Avatar copyright still → JumpTT / missing-title skip (see AGENTS.md language-copyright notes). |
| A4 | open | After activate: gold=`menu vts=4 pgc=2` (hop pgc=5 timed still → VTSM). Ours activates while still in title (no buttons) → `still_skip` → `title vts=5 pgc=5`. So the smoke never exercises the same button as gold. |

**Result:** settled-position **DIFF** (count 2 vs 3; pos[0] pgc/hl; pos[1] menu≠title).

```bash
pnpm nav-oracle -- \
  --video-ts "dvds/Avatar Bk1 Vol3 Eur/VIDEO_TS" \
  --web web/Avatar_Bk1_Vol3_Eur/vm.js \
  --script tests/vm/oracle/scripts/avatar-vol3-smoke.navscript
```

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
