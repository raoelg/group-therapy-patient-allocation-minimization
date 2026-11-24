# Group Therapy RTC Patient Allocation (minimization)

Allocates new patients to the arms (therapy groups) of an ongoing randomized trial so that the covariates stay balanced across arms. The app looks for the allocation with the smallest chi-square imbalance of the strata × arm table of all patients, existing and new. It uses a local search over exchanges of two patients between arms, and then draws one allocation from the search trace: the best one with probability 0.8. Patients who do not fit in the available spots are put on a "wait" list. Raoul Grasman, University of Amsterdam, 2020.

The repository holds two versions of the same app.

## `shiny/`: original R Shiny app (2020)

- `app/GroupTherapyPatientAllocationWebApp.Rmd`, `app/GroupTherapyPatientRandomization.R`: the original app, a flexdashboard R Markdown document with `runtime: shiny`. The files are unchanged.
- `packrat.lock`: the package versions of the 2020 deployment (R 3.5.2: dplyr 0.8.5, tibble 3.0.0, shiny 1.4.0.2, rmarkdown 2.1, flexdashboard 0.5.1.1, …).
- `Dockerfile`, `install_lock.R`, `reinstall_ordered.R`, `shiny-server.conf`: a Docker image with R 3.5.2, Shiny Server 1.5.11 and exactly the locked package versions.
  - Packages come from the Posit Package Manager snapshot of 2020-04-16, with exact versions pinned from the CRAN Archive.
  - A second pass reinstalls everything in dependency order, because a package built while a newer version of one of its dependencies is installed keeps stale code.
  - Shiny Server serves an R Markdown document in an `app_dir` as `index.Rmd`; that is a symlink to the original file.
  - The app directory is read-only for the `shiny` user. Uploads and the rendered page go to the R session's `tempdir()`; no patient data are written next to the app.
  - The R process stops 30 minutes after the last visitor (`app_idle_timeout 1800`), and R then deletes its `tempdir()`.
  - At most 3 simultaneous sessions (`simple_scheduler 3`), at location `/grouptherapy`.
- `Dockerfile.offline`, `fetch_github_sources.sh`, `fix_case.sh`, `install_local.R`: the same image for build machines that cannot reach CRAN, Posit Package Manager or archive.debian.org.
  - The locked packages are cloned from GitHub's CRAN mirror (`github.com/cran/<pkg>`, tag = version) and checked against each package's CRAN `MD5` file. `fix_case.sh` restores file names whose letter case differs in the mirror.
  - The Debian dev headers are copied from `rocker/tidyverse:3.5.2`.
  - The packages are installed once, in dependency order.
  - This is the image that was built and tested here. `src/` and `devlibs.tar` are build inputs only; don't commit them.
- `deploy/`: the nginx location and rate limits, and an hourly cleanup job for leftover temp folders.

**Security:** the original app evaluates the "Available spots" text as R code (`eval(parse())`) after an unanchored check, so anyone who can open the page can run R code on the server. The Docker image therefore patches that one check at build time (last step of the `Dockerfile`): it is anchored, so only `name = integer` pairs reach `eval(parse())`. Valid input behaves exactly as before; `shiny/app/` in the repository stays the original. The static version below has no server and no such problem.

Build and run:

```sh
cd shiny
docker build -t grouptherapy:r3.5.2 .
# or, without CRAN access:  ./fetch_github_sources.sh && docker build -f Dockerfile.offline -t grouptherapy:r3.5.2 .
docker run -d --name grouptherapy --restart unless-stopped \
  -p 127.0.0.1:3838:3838 --memory 1g --cpus 1 grouptherapy:r3.5.2
# app at http://127.0.0.1:3838/grouptherapy/
```

## `docs/`: static HTML + JavaScript version

`index.html` plus `app.js`, in plain JavaScript with no libraries, no build step and no server. Open `index.html` in a browser, or publish the folder with GitHub Pages (Settings → Pages → branch `main`, folder `/docs`). All computation happens in the browser; no data leave the computer.

It has the same inputs, outputs and tabs as the Shiny app:
- **Inputs:** Randomization Seed (default: today's date as YYYYMMDD, set on page load), the two CSV files, the patient-ID column, Available spots, the disabled Randomness slider, and Download All.
- **Tabs:** Existing patients, New patients, Generated allocation, Debug.
  - The Debug tab prints the same text as R's `renderPrint` (byte-identical in all tests).
  - Below it, a "Details of the computation" section (not in the original) shows the initial draw, the search iterations, the sampled imbalance class and the count tables.
- **Download:** `allocation-(<spots>,seed=<seed>)-<date>.csv`, byte-identical to R's `write.csv`.

Reproducing R exactly:
- **Random numbers:** Mersenne-Twister with `set.seed()` scrambling, `unif_rand()`, and `R_unif_index()` for `sample()`. `sample(x, 1, prob = p)` goes through `FixupProb()`, `ProbSampleNoReplace()` and `revsort()`.
- **sample.kind:** "Rounding" (R < 3.6) is the default, because the 2020 deployment ran R 3.5.2. "Rejection" (R ≥ 3.6) can be chosen under *Reproducibility*.
- **Floating point:** R's `sum()` uses an 80-bit long double accumulator, and R 3.5's `round(x, 10)` (before the R 4.0 rewrite) computes in long double. Both are emulated with BigInt arithmetic, so imbalance values, the comparisons `new_imb < best_imb`, `round(imb, 10)` and the `cut()` classes are bit-identical to R on x86-64.
- **Reading and ordering:**
  - `read.csv()` type guessing with `stringsAsFactors = TRUE` (R < 4.0); `check.names`.
  - Factor levels sorted in the deployment locale: en_US.UTF-8, R with ICU. `Intl.Collator('en-US')` is the default; 'C' is optional.
  - `ftable()` row order; dplyr 0.8.5 `arrange_all()` / `arrange_at()` (factors by level, NA last, stable; character in locale order); `rownames_to_column()`.
  - `full_join()` row order; `group_by_at()` group order with one `sample()` per group; `format()` of numeric columns in `as.matrix()`.
- **Node:** the computation code has no DOM code and also loads in Node (`require('./docs/app.js')`).

Deliberate differences from the original (it would crash, misbehave or be unsafe):
- **Spots:** the text is parsed as `name = number` pairs instead of being evaluated as R code. Anything else gives "Error in 'Available spots'", as in the original.
- **Errors** are shown in the Generated allocation tab, and Download is disabled. The original shows "An error has occurred…" and its download fails. A seed outside the integer range gives an error message; the original disconnects.
- **Patient ID:** the patient-ID list has an extra "(none)" choice. The default is still the first column, as in the original.

### Example data

`docs/examples/` holds synthetic test data: random covariates and generated IDs `GT-0001`, …. Each folder has `existing.csv`, `new.csv` and `spots.txt`, which gives the "Available spots" text and a note. Choose "patient" as the patient-ID column, except in `no-id-column`.

| Folder | Existing / new | Available spots | What it shows |
|---|---|---|---|
| `two-covariates-waitlist` | 36 / 10 | `cntrl = 3, expA = 3, expB = 2` | sex × age group; 2 patients go on the wait list |
| `more-spots-than-patients` | 24 / 5 | `A = 4, B = 4, C = 4` | more spots than patients: the arm totals come from the initial random draw only (see ANALYSIS.md) |
| `three-covariates-large` | 120 / 24 | `cntrl = 6, expA = 6, expB = 6, expC = 6` | 3 covariates (18 strata), 4 arms |
| `closed-arm-zero-spots` | 30 / 6 | `A = 3, B = 3, C = 0` | a full arm: its existing patients still count in the balance |
| `no-id-column` | 20 / 6 | `expA = 3, expB = 3` | no ID column: the original takes the first covariate as "ID"; choose "(none)" in the JS version |

Note that uploading the existing-patients file resets "Available spots" to `arm  = 0` for every arm, as in the original, so enter the spots after uploading.

### Known differences from the 2020 deployment

None were found in the tests: 131/131 configurations, 3600 seed-sweep runs, and the browser and Shiny tests (see TEST_RESULTS.md). Residual risks:
- **Collation:** factor levels of text columns are sorted with the browser's ICU collator (en-US). That equals R 3.5.2 with ICU 57 for ordinary names; exotic Unicode text might sort differently in another ICU version.
- **CSV parsing:** malformed or unusual CSV input (embedded newlines in unquoted fields, more fields than header columns, files with a different encoding than UTF-8) may be read differently from R's `read.csv`.
- **R version:** results are for R on x86-64 Linux (long double = 80-bit x87); R on ARM64 (e.g. Apple Silicon) has a different long double and can differ in rare ties.

## `tests/`

- `reference.R` runs the app's server logic without Shiny. It writes all intermediate and final results as JSON: inputs, K, the initial draw, the count tables, the strata order, the full trace, the iterations, `round(imb, 10)`, the breaks, probabilities, sampled class and index, the group sizes, the allocation, the combined table and the RNG state. It also writes `download.csv` and the Debug text.
  - Instrumented copies of the three internal functions record the intermediates.
  - The original `groupTherapyAllocate()` is run again from the same seed and must give an identical result and RNG state.
- `gen.R` generates the synthetic test cases. They cover:
  - 1–3 covariates, including integer (12 levels), logical and decimal covariates and mixed-case/punctuated levels;
  - more spots than patients, a wait list, arms with 0 spots, decimal spots, 1 or 2 new patients;
  - ID column in both files, only in the new file, or absent (pid = first column, or none); text IDs;
  - covariate columns in a different order; covariate values unseen in the existing data; error cases;
  - several seeds (−1, 0, 2^31−1, …); both sample.kinds.
- `run_reference.sh` runs `reference.R` for every configuration: "Rounding" in the R 3.5.2 image, and all configurations in an R 3.6.3 image with the same locked packages (`Dockerfile.r363`, needed for "Rejection").
- `compare.js` runs `docs/app.js` in Node on the same inputs and compares everything exactly (`node tests/compare.js`, or `--markdown` for a table).
- `stress.R` / `stress.js` compare the final allocation and RNG state for 200 seeds per case.
- `browser_test.js` drives `docs/index.html` in headless Chromium (Playwright) and compares the table, Debug text and download with R.
- `shiny_test.js` does the same with the original app in Docker.
- `make_examples.R` writes `docs/examples/`.

The generated `tests/cases/` (data and R outputs) are not included; `run_reference.sh` recreates them.

## Issues found in the original code

See [ANALYSIS.md](ANALYSIS.md) for details. In short:
1. **Remote code execution:** the "Available spots" text is evaluated as R code.
2. **More spots than new patients:** the local search can only exchange patients between arms, so the number of new patients per arm is fixed by the random initial draw. The result is far from optimal (global optimum in 3% of seeds in one example).
3. **Covariate columns in a different order** in the two files: the strata are silently mismatched.
4. **A covariate value that no existing patient has** breaks the matching of spots to patients: other patients lose their arm.
5. **The patient-ID column defaults to the first column:** without an ID column, the first covariate is silently dropped and used as the "ID".
6. **Decimal spots** are accepted and lose patients.
7. **Errors** become an "An error has occurred" message and a failing download; an out-of-range seed disconnects the session.
8. **Arms without existing patients** cannot get spots, and the first patients of a trial cannot be allocated.

The JS version reproduces the original's results, including issues 2–6 and 8, so that allocations made in 2020 can be reproduced. Issue 1 does not apply to it, and issue 7 is handled with messages.
