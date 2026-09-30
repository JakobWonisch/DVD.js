#!/usr/bin/env bash
# Interactive reconvert of ripped VIDEO_TS trees under dvds/ (or DVD_MENU_ARCHIVE_RIPS).
#
# Selection prompt:
#   ""              convert all
#   "1, 2,5, 10"    convert indexes 1, 2, 5, 10
#   "!1"            convert all except index 1
#   "!1, !3"        convert all except 1 and 3
#   If any token is !N, exclude mode wins (bare numbers are ignored).
#
# Usage:
#   pnpm reconvert
#   pnpm reconvert -- "1,2"
#   pnpm reconvert -- "!1"
#   pnpm reconvert -- --full
#   pnpm reconvert -- --full "1,3"
#   DVD_MENU_ARCHIVE_RIPS=/path/to/rips ./scripts/reconvert.sh
#   ./scripts/reconvert.sh --rips /path/to/rips --verbose

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RIPS_DIR="${DVD_MENU_ARCHIVE_RIPS:-$ROOT/dvds}"
CONVERT_FLAGS=()
SELECTION_ARG=""
HAS_SELECTION=0

usage() {
  cat <<'EOF'
Reconvert ripped discs from a VIDEO_TS folder tree.

Usage:
  pnpm reconvert [-- <convert-flags>] [selection]
  ./scripts/reconvert.sh [--rips DIR] [--full] [--verbose] [-v] [selection]

Selection (prompted if omitted):
  empty            all discs
  1,2,5            only those indexes
  !1  or  !1,!3    all except those indexes

Environment:
  DVD_MENU_ARCHIVE_RIPS       override default rip dir (repo dvds/)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --rips)
      RIPS_DIR="$2"
      shift 2
      ;;
    --full|--verbose|-v|--vm-only|--upload)
      CONVERT_FLAGS+=("$1")
      shift
      ;;
    --)
      shift
      ;;
    -*)
      # Pass unknown flags through to convert (e.g. future options).
      CONVERT_FLAGS+=("$1")
      shift
      ;;
    *)
      SELECTION_ARG="$1"
      HAS_SELECTION=1
      shift
      ;;
  esac
done

if [[ ! -d "$RIPS_DIR" ]]; then
  echo "Rip directory not found: $RIPS_DIR" >&2
  echo "Set DVD_MENU_ARCHIVE_RIPS or pass --rips DIR." >&2
  exit 1
fi

mapfile -t DISCS < <(
  find "$RIPS_DIR" -mindepth 1 -maxdepth 1 -type d \
    ! -name '.*' \
    -printf '%f\n' \
    | LC_ALL=C sort \
    | while IFS= read -r name; do
        if [[ -d "$RIPS_DIR/$name/VIDEO_TS" ]]; then
          printf '%s\n' "$name"
        fi
      done
)

if [[ ${#DISCS[@]} -eq 0 ]]; then
  echo "No ripped discs (*/VIDEO_TS) under $RIPS_DIR" >&2
  exit 1
fi

echo "Ripped discs in $RIPS_DIR:"
echo
for i in "${!DISCS[@]}"; do
  printf '  %2d  %s\n' "$((i + 1))" "${DISCS[$i]}"
done
echo

if [[ $HAS_SELECTION -eq 0 ]]; then
  read -r -p 'Select (empty=all, 1,2,5=include, !1=exclude): ' SELECTION_ARG || true
fi

# Normalize: commas/spaces → tokens
normalize_selection() {
  local raw="$1"
  raw="${raw//,/ }"
  # shellcheck disable=SC2086
  set -- $raw
  printf '%s\n' "$@"
}

declare -a SELECTED=()

if [[ -z "${SELECTION_ARG//[[:space:],]/}" ]]; then
  SELECTED=("${DISCS[@]}")
else
  mapfile -t TOKENS < <(normalize_selection "$SELECTION_ARG")
  EXCLUDE_MODE=0
  declare -a EXCLUDE_IDX=()
  declare -a INCLUDE_IDX=()

  for tok in "${TOKENS[@]}"; do
    [[ -z "$tok" ]] && continue
    if [[ "$tok" == !* ]]; then
      EXCLUDE_MODE=1
      num="${tok#!}"
      if [[ ! "$num" =~ ^[0-9]+$ ]]; then
        echo "Invalid exclusion token: $tok" >&2
        exit 1
      fi
      EXCLUDE_IDX+=("$num")
    else
      if [[ ! "$tok" =~ ^[0-9]+$ ]]; then
        echo "Invalid selection token: $tok" >&2
        exit 1
      fi
      INCLUDE_IDX+=("$tok")
    fi
  done

  if [[ $EXCLUDE_MODE -eq 1 ]]; then
    declare -A SKIP=()
    for n in "${EXCLUDE_IDX[@]}"; do
      if (( n < 1 || n > ${#DISCS[@]} )); then
        echo "Index out of range: !$n (1-${#DISCS[@]})" >&2
        exit 1
      fi
      SKIP["$n"]=1
    done
    for i in "${!DISCS[@]}"; do
      idx=$((i + 1))
      if [[ -z "${SKIP[$idx]:-}" ]]; then
        SELECTED+=("${DISCS[$i]}")
      fi
    done
  else
    declare -A SEEN=()
    for n in "${INCLUDE_IDX[@]}"; do
      if (( n < 1 || n > ${#DISCS[@]} )); then
        echo "Index out of range: $n (1-${#DISCS[@]})" >&2
        exit 1
      fi
      if [[ -n "${SEEN[$n]:-}" ]]; then
        continue
      fi
      SEEN["$n"]=1
      SELECTED+=("${DISCS[$((n - 1))]}")
    done
  fi
fi

if [[ ${#SELECTED[@]} -eq 0 ]]; then
  echo "Nothing selected." >&2
  exit 1
fi

echo
echo "Will convert ${#SELECTED[@]} disc(s):"
for name in "${SELECTED[@]}"; do
  echo "  - $name"
done
if [[ ${#CONVERT_FLAGS[@]} -gt 0 ]]; then
  echo "Convert flags: ${CONVERT_FLAGS[*]}"
fi
echo

cd "$ROOT"
FAILED=0
for name in "${SELECTED[@]}"; do
  src="$RIPS_DIR/$name"
  echo "======== converting: $name ========"
  if ! pnpm convert -- "${CONVERT_FLAGS[@]}" "$src"; then
    echo "FAILED: $name" >&2
    FAILED=1
  fi
  echo
done

if [[ $FAILED -ne 0 ]]; then
  echo "One or more converts failed." >&2
  exit 1
fi

echo "All selected converts finished."
