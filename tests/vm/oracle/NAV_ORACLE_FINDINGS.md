# Nav oracle findings (Part 3)

Disc-path compare: native `dvdnav-oracle play` vs headless `vm.js` replay on shared `.navscript` files. Settled positions = `compareTraces` snapshots after `pump` / `still` / `pos` / `end` (cell chatter collapsed).

**Explore** (`pnpm nav-oracle -- … --explore`): BFS every interactive menu screen (libdvdnav), activate each button, cold-start path-replay vs `vm.js`. Titles are destinations only (not expanded). Caps: `--max-screens` / `--max-depth`. Smokes can pass while explore surfaces deeper JumpTT / button-cmd gaps (e.g. Shrek submenu buttons diverting to the wrong title on ours).

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

pnpm nav-oracle -- \
  --video-ts "dvds/Lotr See D1/VIDEO_TS" \
  --web web/Lotr_See_D1/vm.js \
  --script tests/vm/oracle/scripts/lotr-see-d1-smoke.navscript

pnpm nav-oracle -- \
  --video-ts "dvds/Avatar Bk1 Vol3 Eur/VIDEO_TS" \
  --web web/Avatar_Bk1_Vol3_Eur/vm.js \
  --script tests/vm/oracle/scripts/avatar-vol3-smoke.navscript

# Full menu graph (every screen + every button):
pnpm nav-oracle -- --video-ts dvds/Shrek --web web/Shrek/vm.js --explore \
  --max-screens 200 --max-depth 15
```


Status legend: **fixed** | open (corpus)

---

## Shrek (`shrek-smoke.navscript`)

| ID | Status | Finding |
|----|--------|---------|
| S1 | **fixed** | FP path briefly enters title VTS_05 then returns to VMGM Title menu. Headless replay drains short title PGCs via `playTitleCell` / `playByID` → `post()`. |
| S2 | **fixed** | Soft cell compare: same `space/vts/pgc/hl` counts as one menu when cell index differs. |
| S3 | **fixed** | `still_time === 255` settles; `still_time === 0` + buttons emit WAIT (not fake infinite still). |

**Result:** `OK — settled positions match`

### Shrek explore (`--explore --max-screens 200 --max-depth 15`)

| ID | Status | Finding |
|----|--------|---------|
| SE1 | **fixed** | Skip-stub titles: replay left `_dvdjsFromButton` set so `tryAutoSkipMissingTitle` no-op'd (held on omitted VTS_03). Match viewer `playSkipTitleStub` — clear latch then `post()`. |
| SE2 | **fixed** | Re-entering the same skip stub (special-features btn6 twice) hit missing-title cycle detection → VMGM Title. Clear skip set on `playMenuCell` like the viewer. |
| SE3 | **fixed** | Explore compare: gold may settle inside omitted features (Play → VTS_01) while ours stub-skips to a menu — soft-pass when `metadata.titlePgcMedia` marks the gold title omitted. |

**Result:** `OK — menu graph destinations match` (200 screens / 707 edges at caps; graph larger than cap — truncated, no bad edges)

---

## Harry Potter (`harry-potter-smoke.navscript`)

| ID | Status | Finding |
|----|--------|---------|
| H1 | **fixed** | JumpSS/CallSS emit `lang = pickLang(…) \|\| lang` before `MPGCIUT`/`MENU_TYPES` (VMGM LU may be `"default"`). |
| H2 | **fixed** | Feature-length titles hold (no auto-`post`); short bumpers post. |
| H3 | **fixed** | Soft cell / hl-0 rules cover VTS_CHANGE cell timing. |
| H4 | **fixed** | Replay implements `pump … until=wait\|still\|vts` like play.c. |

**Result:** `OK — settled positions match`

---

## Lotr See D1 (`lotr-see-d1-smoke.navscript`)

| ID | Status | Finding |
|----|--------|---------|
| L1 | **fixed** | PGC2 cell2 has `still_time` 0 + buttons and PGC `post → linkPGC(11)`. Harness was treating any button menu as infinite still; now emits WAIT and auto-`wait_skip` when `until` omits `wait` (script uses `until=still`). |
| L2 | **fixed** | Same path; activate on pgc=11 lands on title. |

**Result:** `OK — settled positions match`

---

## Avatar Bk1 Vol1 Eur (`avatar-vol1-smoke.navscript`)

| ID | Status | Finding |
|----|--------|---------|
| A1 | **fixed** (corpus soft-pass) | Gold cannot finish: rip has `VTS_03_0.IFO` but no `VTS_03_*.VOB`. `play.c` soft-emits `error` + stops scripting. `compareTraces` soft-passes when gold errors and ours has settled positions. |
| A2 | **fixed** | Title cell loops / missing-title skip capped; skip stubs + auto-skip escape; activate on title without buttons no longer `still_skip`-loops. |

**Result:** soft-pass (gold incomplete; ours reaches language menu pgc=3)

---

## Avatar Bk1 Vol3 Eur (`avatar-vol3-smoke.navscript`)

| ID | Status | Finding |
|----|--------|---------|
| A3 | **fixed** | Product: `VTT_TABLE` was built by walking each VTS PGC list with a running title counter. JumpTT 6 (IFO → VTS_02) wrongly mapped to domain 5. Now built from VMG `TT_SRPT` + `vts_ttn` as title PGC index. |
| A4 | **fixed** | Harness: finite stills deferred to pump; `until=vts` checked before auto-skip; `activate` uses current highlight (language menu defaults to button 2); skip stubs drain FP logo titles. |

**Result:** `OK — settled positions match`

---

## Cross-cutting harness notes

| ID | Status | Note |
|----|--------|------|
| X1 | **fixed** | Infinite still (`255`) settles; finite stills auto-skip in pump; WAIT for motion+buttons. |
| X2 | **fixed** | Short titles post; long titles hold; `stubs.kind=skip` → missing-title auto-skip. |
| X3 | **fixed** | Replay `pump` honors `until=still\|wait\|vts\|stop`. |

---

## Product fixes (regenerate `vm.js`)

1. **`src/vm/recompile.ts`** — JumpSS/CallSS `pickLang` before LU indexing.
2. **`src/server/convert/generateJavaScript.ts`** — `VTT_TABLE` from `TT_SRPT` / `vts_ttn` (not sequential PGC walk).

```bash
pnpm build
pnpm convert -- --vm-only --web <discId>
tar -xzf web/<discId>.tar.gz -C web
```
