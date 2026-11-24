#!/bin/sh
# Alternative to install_lock.R for build machines that cannot reach CRAN / Posit Package Manager:
# fetch every package of packrat.lock at its exact version from GitHub's read-only CRAN mirror
# (https://github.com/cran/<package>, one tag per CRAN release) into ./src/<package>.
# Used together with Dockerfile.offline and install_local.R.
set -e
cd "$(dirname "$0")"
mkdir -p src
grep -E '^(Package|Version):' packrat.lock | paste - - | awk '{print $2, $4}' |
  xargs -P 8 -n 2 sh -c '[ -d src/$0 ] || { git -c advice.detachedHead=false clone -q --depth 1 --branch "$1" https://github.com/cran/$0.git src/$0 && rm -rf src/$0/.git; }'
./fix_case.sh src/*
for d in src/*; do
  (cd "$d" && md5sum --quiet -c MD5) || { echo "MD5 check failed for $d"; exit 1; }
  p=$(basename "$d"); v=$(grep -m1 '^Version:' "$d/DESCRIPTION" | awk '{print $2}')
  grep -q "^Package: $p\$" packrat.lock || continue
  w=$(grep -A2 "^Package: $p\$" packrat.lock | grep '^Version:' | awk '{print $2}')
  [ "$v" = "$w" ] || { echo "version mismatch for $p: $v (src) vs $w (lock)"; exit 1; }
done
echo "fetched $(ls src | wc -l) packages"
# Debian stretch development headers (libxml2-dev, libssl-dev, libicu-dev) when apt cannot reach
# archive.debian.org: copy them from the rocker/tidyverse:3.5.2 image (same Debian release and versions).
[ -f devlibs.tar ] || docker run --rm rocker/tidyverse:3.5.2 sh -c 'dpkg -L libxml2-dev libssl-dev libicu-dev | while read f; do { [ -f "$f" ] || [ -L "$f" ]; } && echo "$f"; done | grep -v "^/usr/share" | tar cf - -T - 2>/dev/null' > devlibs.tar
