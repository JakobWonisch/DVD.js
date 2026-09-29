# Generation — local rip inventory

Dev cheat sheet for re-converting discs already under `dvds/` (gitignored). These trees are decrypted `VIDEO_TS` folders — **no `--rip`**.

Run from the repo root. Default convert is **menus only**; add `--full` only if you want title VOBs too.

```bash
# Optional: regenerate vm.js only (needs an existing webFolder package)
pnpm convert -- --vm-only --web <discId>
```

---

## Rips on hand

| Disc | Source path (contains `VIDEO_TS/`) | Notes |
|------|-------------------------------------|--------|
| Harry Potter and the Philosopher’s Stone | `dvds/Harry Potter Philosophers Ston` | Folder name truncated |
| LOTR Fellowship — disc 1 (theatrical?) | `dvds/lotr1_part1/lotr1_part1` | Nested one level |
| LOTR Fellowship — extras part 2 | `dvds/lotr1_extras_part2` | |
| LOTR Special Extended Edition — D1 | `dvds/LOTR_SEE_D1` | |

---

## Re-convert (menus only, no rip)

```bash
pnpm convert -- "dvds/Harry Potter Philosophers Ston"

pnpm convert -- dvds/lotr1_part1/lotr1_part1

pnpm convert -- dvds/lotr1_extras_part2

pnpm convert -- dvds/LOTR_SEE_D1
```

Harry Potter scene selection: after still/opacity fixes, re-run at least the convert above so last-page stills are re-extracted (cell-clipped; no Special Features bleed).
## Re-convert with titles (`--full`)

```bash
pnpm convert -- --full "dvds/Harry Potter Philosophers Ston"

pnpm convert -- --full dvds/lotr1_part1/lotr1_part1

pnpm convert -- --full dvds/lotr1_extras_part2

pnpm convert -- --full dvds/LOTR_SEE_D1
```

## Verbose ffmpeg (debug encodes)

```bash
pnpm convert -- --verbose "dvds/Harry Potter Philosophers Ston"
# …same paths as above
```
