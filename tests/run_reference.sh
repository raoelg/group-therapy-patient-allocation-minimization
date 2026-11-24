#!/bin/sh
# Generate the test cases and run reference.R for every configuration:
#  - sample.kind "Rounding" configs on R 3.5.2 (the 2020 deployment image grouptherapy:r3.5.2)  -> r352_<j>/
#  - all configs on R 3.6.3 with the same locked packages (image gta-r363), for "Rejection"     -> r363_<j>/
#    (its "Rounding" results must equal the R 3.5.2 ones)
set -e
cd "$(dirname "$0")/.."
P=$(pwd)
docker run --rm -v "$P":/w -w /w/tests grouptherapy:r3.5.2 Rscript gen.R /w/tests
# the example data sets of docs/examples as cases ex_<name> (seed 20200416, both sample.kinds)
for e in docs/examples/*/; do
  n=$(basename "$e"); d=tests/cases/ex_$n; mkdir -p "$d"; cp "$e/existing.csv" "$e/new.csv" "$d/"
  spots=$(head -1 "$e/spots.txt"); pid=patient; [ "$n" = no-id-column ] && pid=""
  i=1; for kind in Rounding Rejection; do
    printf '{"seed":20200416,"samplekind":"%s","existing":"/w/%s/existing.csv","new":"/w/%s/new.csv","spots":"%s","pid":"%s"}\n' $kind "$d" "$d" "$spots" "$pid" > "$d/config_0$i.json"; i=$((i+1))
  done
done
for cf in tests/cases/*/config_*.json; do
  d=$(dirname "$cf"); j=$(basename "$cf" .json | sed 's/config_//')
  if grep -q '"samplekind":"Rounding"' "$cf"; then
    docker run --rm -v "$P":/w -w /w grouptherapy:r3.5.2 Rscript tests/reference.R "/w/$cf" "/w/$d/r352_$j" shiny/app/GroupTherapyPatientRandomization.R > "$d/r352_$j.log" 2>&1 || echo "R 3.5.2 failed: $cf"
  fi
  if docker image inspect gta-r363 >/dev/null 2>&1; then
    docker run --rm -v "$P":/w -w /w gta-r363 Rscript tests/reference.R "/w/$cf" "/w/$d/r363_$j" shiny/app/GroupTherapyPatientRandomization.R > "$d/r363_$j.log" 2>&1 || echo "R 3.6.3 failed: $cf"
  fi
done
