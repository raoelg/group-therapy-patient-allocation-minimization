#!/bin/sh
# GitHub's CRAN mirror keeps the old letter case of files that were renamed only by case
# (e.g. dbplyr R/query.r -> R/query.R). Restore the names listed in each package's MD5 file.
for d in "$@"; do
  [ -f "$d/MD5" ] || continue
  sed 's/^[0-9a-f]* \*//' "$d/MD5" | while IFS= read -r f; do
    [ -e "$d/$f" ] && continue
    dir=$(dirname "$d/$f"); base=$(basename "$f")
    [ -d "$dir" ] || continue
    alt=$(ls "$dir" | grep -ix -- "$base" | head -1)
    [ -n "$alt" ] && mv "$dir/$alt" "$dir/$base" && echo "renamed $d: $alt -> $base"
  done
done
