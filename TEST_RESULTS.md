# Test results

All tests were run on 2026-11-24. The static version (`docs/app.js`) was compared with the original R code running in the original package environment:
- **R 3.5.2:** the Docker image built from `shiny/Dockerfile.offline`, rocker/shiny:3.5.2 with all 104 packages of `packrat.lock` at their exact versions (dplyr 0.8.5, tibble 3.0.0, …), locale en_US.UTF-8 with ICU, x86-64. This is the 2020 deployment environment. Used for sample.kind "Rounding".
- **R 3.6.3:** rocker/tidyverse:3.6.3 with the same 104 locked packages installed from source. Used for sample.kind "Rejection", which needs R ≥ 3.6. Its "Rounding" results were also compared, as a cross-check with R 3.5.2.

**Result: every test passes. No difference was found between the JS version and R.**

| Test | What is compared | Result |
|---|---|---|
| `tests/compare.js` (Node) | 131 configurations (25 cases × seeds × sample.kind; 3 error cases); per configuration up to 23 exact checks, listed below the table | **131/131 identical** |
| `tests/stress.js` (Node) | final allocation + RNG state for 200 seeds × 9 cases | **1800/1800** (R 3.5.2, Rounding), **1800/1800** (R 3.6.3, Rejection) |
| `tests/browser_test.js` (headless Chromium) | `docs/index.html`: allocation table, Debug text, downloaded CSV bytes vs R; default seed = today; console errors | **15/15 pass** (table below) |
| `tests/shiny_test.js` (headless Chromium) | the **original Shiny app** in Docker (R 3.5.2): page load, upload, allocation, Download All bytes vs `reference.R` | **5/5 downloads identical** (c02, c05 with pid = first column, c10, c13, ex_three-covariates-large) |
| Mutation check | `sum()` replaced by a plain double sum / `round()` without long double | 34 / 16 configurations fail, so the tests detect these differences |

The checks per configuration:
- **Reading the input:** `read.csv` column classes, factor levels and values for both files; the parsed spots `k`.
- **Initial allocation:** K, `levels_wait`, the initial draw `sample(rep(names(K), K))[1:nnew]`, `current_counts`, `new_counts`, `non_zero_rows`.
- **Search:** every trace imbalance as an exact double (`%a`), every trace count table, the iterations, the final counts.
- **Sampling:** `round(imb, 10)` as an exact double, the breaks, the probabilities, the sampled class and trace index, the sampled counts, the group sizes.
- **Output:** the allocation, the combined table, the `download.csv` bytes, the complete RNG state (`.Random.seed`) after the run.
- **Debug:** the Debug tab text, byte-identical.

The original Shiny app in Docker:
- **Page:** the page loads (title "Group Therapy RTC Patient Assignment"; first load about 3 s, then about 1 s). The default seed is today's date.
- **Allocation:** uploading the existing patients resets the spots to `arm  = 0`, as the code says. The allocation is computed, and the Debug tab shows it.
- **Download:** the downloaded CSV equals R's `download.csv`.
- **Error behaviour** (see ANALYSIS.md):
  - with a k-name error, the allocation tab shows "An error has occurred" and Download All fails (`invalid numbers in 'quote'`);
  - a seed of 99999999999 disconnects the session;
  - an R expression in "Available spots" is executed.
- **Data on disk:** no files are written next to the Rmd; uploads go to `/tmp/Rtmp*/`.

The online `shiny/Dockerfile` (apt from archive.debian.org, packages from packagemanager.posit.co and the CRAN Archive) **could not be built here**: this sandbox can reach only GitHub, Docker Hub and npm. It installs the same packages at the same versions as the tested `Dockerfile.offline`, using the same procedure as the model repository's Dockerfile.

## Headless browser test of `docs/index.html`

| Case / config | sample.kind | Allocation = R | Debug = R | Download bytes = R | Default seed = today | Console errors |
|---|---|---|---|---|---|---|
| c01_one_cov_more_spots/01 | Rounding | True | True | True | True | 0 |
| c02_two_cov_wait/01 | Rounding | True | True | True | True | 0 |
| c05_no_id_column/03 | Rounding | True | True | True | True | 0 |
| c07_levels_collation/02 | Rejection | True | True | True | True | 0 |
| c09_new_level_not_in_existing/01 | Rounding | True | True | True | True | 0 |
| c10_large/02 | Rejection | True | True | True | True | 0 |
| c12_error_k_names/01 | Rounding | n/a (error case) | True | disabled (error) | True | 0 |
| c13_logical_double_covs/02 | Rejection | True | True | True | True | 0 |
| c16_char_ids_many_spots/01 | Rounding | True | True | True | True | 0 |
| c20_fractional_spots/01 | Rounding | True | True | True | True | 0 |
| ex_two-covariates-waitlist/01 | Rounding | True | True | True | True | 0 |
| ex_more-spots-than-patients/01 | Rounding | True | True | True | True | 0 |
| ex_three-covariates-large/02 | Rejection | True | True | True | True | 0 |
| ex_closed-arm-zero-spots/01 | Rounding | True | True | True | True | 0 |
| ex_no-id-column/01 | Rounding | True | True | True | True | 0 |

All pages also had no horizontal scroll at phone width (390 px).

## `compare.js`: all configurations

R 3.5.2 rows use sample.kind "Rounding"; R 3.6.3 rows use "Rounding" (cross-check) or "Rejection". "pid" is the patient-ID column passed to `groupTherapyAllocate`: `(none)` = "". In `c05` config 1, the first column (`sex`) is used, as the original app does by default.

| Case / config | R | seed | sample.kind | pid | Result | Checks passed | Debug text identical |
|---|---|---|---|---|---|---|---|
| c01_one_cov_more_spots/config_01 | 3.5.2 | 20200416 | Rounding | id | PASS | 23 | yes |
| c01_one_cov_more_spots/config_01 | 3.6.3 | 20200416 | Rounding | id | PASS | 23 | yes |
| c01_one_cov_more_spots/config_02 | 3.6.3 | 20200416 | Rejection | id | PASS | 23 | yes |
| c01_one_cov_more_spots/config_03 | 3.5.2 | 1 | Rounding | id | PASS | 23 | yes |
| c01_one_cov_more_spots/config_03 | 3.6.3 | 1 | Rounding | id | PASS | 23 | yes |
| c01_one_cov_more_spots/config_04 | 3.6.3 | 1 | Rejection | id | PASS | 23 | yes |
| c02_two_cov_wait/config_01 | 3.5.2 | 20200416 | Rounding | id | PASS | 23 | yes |
| c02_two_cov_wait/config_01 | 3.6.3 | 20200416 | Rounding | id | PASS | 23 | yes |
| c02_two_cov_wait/config_02 | 3.6.3 | 20200416 | Rejection | id | PASS | 23 | yes |
| c02_two_cov_wait/config_03 | 3.5.2 | 7 | Rounding | id | PASS | 23 | yes |
| c02_two_cov_wait/config_03 | 3.6.3 | 7 | Rounding | id | PASS | 23 | yes |
| c02_two_cov_wait/config_04 | 3.6.3 | 7 | Rejection | id | PASS | 23 | yes |
| c03_three_cov_exact/config_01 | 3.5.2 | 20200501 | Rounding | id | PASS | 23 | yes |
| c03_three_cov_exact/config_01 | 3.6.3 | 20200501 | Rounding | id | PASS | 23 | yes |
| c03_three_cov_exact/config_02 | 3.6.3 | 20200501 | Rejection | id | PASS | 23 | yes |
| c03_three_cov_exact/config_03 | 3.5.2 | 99 | Rounding | id | PASS | 23 | yes |
| c03_three_cov_exact/config_03 | 3.6.3 | 99 | Rounding | id | PASS | 23 | yes |
| c03_three_cov_exact/config_04 | 3.6.3 | 99 | Rejection | id | PASS | 23 | yes |
| c04_zero_spot_arm/config_01 | 3.5.2 | 20200416 | Rounding | id | PASS | 23 | yes |
| c04_zero_spot_arm/config_01 | 3.6.3 | 20200416 | Rounding | id | PASS | 23 | yes |
| c04_zero_spot_arm/config_02 | 3.6.3 | 20200416 | Rejection | id | PASS | 23 | yes |
| c04_zero_spot_arm/config_03 | 3.5.2 | 3 | Rounding | id | PASS | 23 | yes |
| c04_zero_spot_arm/config_03 | 3.6.3 | 3 | Rounding | id | PASS | 23 | yes |
| c04_zero_spot_arm/config_04 | 3.6.3 | 3 | Rejection | id | PASS | 23 | yes |
| c05_no_id_column/config_01 | 3.5.2 | 20200416 | Rounding | sex | PASS | 23 | yes |
| c05_no_id_column/config_01 | 3.6.3 | 20200416 | Rounding | sex | PASS | 23 | yes |
| c05_no_id_column/config_02 | 3.6.3 | 20200416 | Rejection | sex | PASS | 23 | yes |
| c05_no_id_column/config_03 | 3.5.2 | 20200416 | Rounding | (none) | PASS | 23 | yes |
| c05_no_id_column/config_03 | 3.6.3 | 20200416 | Rounding | (none) | PASS | 23 | yes |
| c05_no_id_column/config_04 | 3.6.3 | 20200416 | Rejection | (none) | PASS | 23 | yes |
| c06_id_only_in_new/config_01 | 3.5.2 | 20200416 | Rounding | id | PASS | 23 | yes |
| c06_id_only_in_new/config_01 | 3.6.3 | 20200416 | Rounding | id | PASS | 23 | yes |
| c06_id_only_in_new/config_02 | 3.6.3 | 20200416 | Rejection | id | PASS | 23 | yes |
| c06_id_only_in_new/config_03 | 3.5.2 | 11 | Rounding | id | PASS | 23 | yes |
| c06_id_only_in_new/config_03 | 3.6.3 | 11 | Rounding | id | PASS | 23 | yes |
| c06_id_only_in_new/config_04 | 3.6.3 | 11 | Rejection | id | PASS | 23 | yes |
| c07_levels_collation/config_01 | 3.5.2 | 20200416 | Rounding | id | PASS | 23 | yes |
| c07_levels_collation/config_01 | 3.6.3 | 20200416 | Rounding | id | PASS | 23 | yes |
| c07_levels_collation/config_02 | 3.6.3 | 20200416 | Rejection | id | PASS | 23 | yes |
| c07_levels_collation/config_03 | 3.5.2 | 5 | Rounding | id | PASS | 23 | yes |
| c07_levels_collation/config_03 | 3.6.3 | 5 | Rounding | id | PASS | 23 | yes |
| c07_levels_collation/config_04 | 3.6.3 | 5 | Rejection | id | PASS | 23 | yes |
| c08_cov_order_differs/config_01 | 3.5.2 | 20200416 | Rounding | id | PASS | 23 | yes |
| c08_cov_order_differs/config_01 | 3.6.3 | 20200416 | Rounding | id | PASS | 23 | yes |
| c08_cov_order_differs/config_02 | 3.6.3 | 20200416 | Rejection | id | PASS | 23 | yes |
| c08_cov_order_differs/config_03 | 3.5.2 | 8 | Rounding | id | PASS | 23 | yes |
| c08_cov_order_differs/config_03 | 3.6.3 | 8 | Rounding | id | PASS | 23 | yes |
| c08_cov_order_differs/config_04 | 3.6.3 | 8 | Rejection | id | PASS | 23 | yes |
| c09_new_level_not_in_existing/config_01 | 3.5.2 | 20200416 | Rounding | id | PASS | 23 | yes |
| c09_new_level_not_in_existing/config_01 | 3.6.3 | 20200416 | Rounding | id | PASS | 23 | yes |
| c09_new_level_not_in_existing/config_02 | 3.6.3 | 20200416 | Rejection | id | PASS | 23 | yes |
| c09_new_level_not_in_existing/config_03 | 3.5.2 | 9 | Rounding | id | PASS | 23 | yes |
| c09_new_level_not_in_existing/config_03 | 3.6.3 | 9 | Rounding | id | PASS | 23 | yes |
| c09_new_level_not_in_existing/config_04 | 3.6.3 | 9 | Rejection | id | PASS | 23 | yes |
| c10_large/config_01 | 3.5.2 | 20200416 | Rounding | id | PASS | 23 | yes |
| c10_large/config_01 | 3.6.3 | 20200416 | Rounding | id | PASS | 23 | yes |
| c10_large/config_02 | 3.6.3 | 20200416 | Rejection | id | PASS | 23 | yes |
| c10_large/config_03 | 3.5.2 | 2020 | Rounding | id | PASS | 23 | yes |
| c10_large/config_03 | 3.6.3 | 2020 | Rounding | id | PASS | 23 | yes |
| c10_large/config_04 | 3.6.3 | 2020 | Rejection | id | PASS | 23 | yes |
| c11_spots_from_existing_all_wait/config_01 | 3.5.2 | 20200416 | Rounding | id | PASS | 20 | yes |
| c11_spots_from_existing_all_wait/config_01 | 3.6.3 | 20200416 | Rounding | id | PASS | 20 | yes |
| c11_spots_from_existing_all_wait/config_02 | 3.6.3 | 20200416 | Rejection | id | PASS | 20 | yes |
| c12_error_k_names/config_01 | 3.5.2 | 20200416 | Rounding | id | PASS (same error: The array k should be named with names that are levels in df[,"arm"].) | 4 | yes |
| c12_error_k_names/config_01 | 3.6.3 | 20200416 | Rounding | id | PASS (same error: The array k should be named with names that are levels in df[,"arm"].) | 4 | yes |
| c12_error_k_names/config_02 | 3.6.3 | 20200416 | Rejection | id | PASS (same error: The array k should be named with names that are levels in df[,"arm"].) | 4 | yes |
| c13_logical_double_covs/config_01 | 3.5.2 | 20200416 | Rounding | id | PASS | 23 | yes |
| c13_logical_double_covs/config_01 | 3.6.3 | 20200416 | Rounding | id | PASS | 23 | yes |
| c13_logical_double_covs/config_02 | 3.6.3 | 20200416 | Rejection | id | PASS | 23 | yes |
| c13_logical_double_covs/config_03 | 3.5.2 | 13 | Rounding | id | PASS | 23 | yes |
| c13_logical_double_covs/config_03 | 3.6.3 | 13 | Rounding | id | PASS | 23 | yes |
| c13_logical_double_covs/config_04 | 3.6.3 | 13 | Rejection | id | PASS | 23 | yes |
| c14_single_new_patient/config_01 | 3.5.2 | 20200416 | Rounding | id | PASS | 20 | yes |
| c14_single_new_patient/config_01 | 3.6.3 | 20200416 | Rounding | id | PASS | 20 | yes |
| c14_single_new_patient/config_02 | 3.6.3 | 20200416 | Rejection | id | PASS | 20 | yes |
| c14_single_new_patient/config_03 | 3.5.2 | 14 | Rounding | id | PASS | 20 | yes |
| c14_single_new_patient/config_03 | 3.6.3 | 14 | Rounding | id | PASS | 20 | yes |
| c14_single_new_patient/config_04 | 3.6.3 | 14 | Rejection | id | PASS | 20 | yes |
| c14_single_new_patient/config_05 | 3.5.2 | 15 | Rounding | id | PASS | 20 | yes |
| c14_single_new_patient/config_05 | 3.6.3 | 15 | Rounding | id | PASS | 20 | yes |
| c14_single_new_patient/config_06 | 3.6.3 | 15 | Rejection | id | PASS | 20 | yes |
| c15_one_stratum_two_patients/config_01 | 3.5.2 | 20200416 | Rounding | id | PASS | 20 | yes |
| c15_one_stratum_two_patients/config_01 | 3.6.3 | 20200416 | Rounding | id | PASS | 20 | yes |
| c15_one_stratum_two_patients/config_02 | 3.6.3 | 20200416 | Rejection | id | PASS | 20 | yes |
| c15_one_stratum_two_patients/config_03 | 3.5.2 | 16 | Rounding | id | PASS | 20 | yes |
| c15_one_stratum_two_patients/config_03 | 3.6.3 | 16 | Rounding | id | PASS | 20 | yes |
| c15_one_stratum_two_patients/config_04 | 3.6.3 | 16 | Rejection | id | PASS | 20 | yes |
| c16_char_ids_many_spots/config_01 | 3.5.2 | 20200416 | Rounding | id | PASS | 23 | yes |
| c16_char_ids_many_spots/config_01 | 3.6.3 | 20200416 | Rounding | id | PASS | 23 | yes |
| c16_char_ids_many_spots/config_02 | 3.6.3 | 20200416 | Rejection | id | PASS | 23 | yes |
| c16_char_ids_many_spots/config_03 | 3.5.2 | 17 | Rounding | id | PASS | 23 | yes |
| c16_char_ids_many_spots/config_03 | 3.6.3 | 17 | Rounding | id | PASS | 23 | yes |
| c16_char_ids_many_spots/config_04 | 3.6.3 | 17 | Rejection | id | PASS | 23 | yes |
| c17_seeds/config_01 | 3.5.2 | -1 | Rounding | id | PASS | 23 | yes |
| c17_seeds/config_01 | 3.6.3 | -1 | Rounding | id | PASS | 23 | yes |
| c17_seeds/config_02 | 3.6.3 | -1 | Rejection | id | PASS | 23 | yes |
| c17_seeds/config_03 | 3.5.2 | 0 | Rounding | id | PASS | 23 | yes |
| c17_seeds/config_03 | 3.6.3 | 0 | Rounding | id | PASS | 23 | yes |
| c17_seeds/config_04 | 3.6.3 | 0 | Rejection | id | PASS | 23 | yes |
| c17_seeds/config_05 | 3.5.2 | 2147483647 | Rounding | id | PASS | 23 | yes |
| c17_seeds/config_05 | 3.6.3 | 2147483647 | Rounding | id | PASS | 23 | yes |
| c17_seeds/config_06 | 3.6.3 | 2147483647 | Rejection | id | PASS | 23 | yes |
| c17_seeds/config_07 | 3.5.2 | 123456789 | Rounding | id | PASS | 23 | yes |
| c17_seeds/config_07 | 3.6.3 | 123456789 | Rounding | id | PASS | 23 | yes |
| c17_seeds/config_08 | 3.6.3 | 123456789 | Rejection | id | PASS | 23 | yes |
| c18_error_extra_column/config_01 | 3.5.2 | 1 | Rounding | (none) | PASS (same error: The only difference between df and new should be an extra 'arm' column in df.) | 4 | yes |
| c18_error_extra_column/config_01 | 3.6.3 | 1 | Rounding | (none) | PASS (same error: The only difference between df and new should be an extra 'arm' column in df.) | 4 | yes |
| c19_unbalanced_existing/config_01 | 3.5.2 | 20200416 | Rounding | id | PASS | 23 | yes |
| c19_unbalanced_existing/config_01 | 3.6.3 | 20200416 | Rounding | id | PASS | 23 | yes |
| c19_unbalanced_existing/config_02 | 3.6.3 | 20200416 | Rejection | id | PASS | 23 | yes |
| c19_unbalanced_existing/config_03 | 3.5.2 | 19 | Rounding | id | PASS | 23 | yes |
| c19_unbalanced_existing/config_03 | 3.6.3 | 19 | Rounding | id | PASS | 23 | yes |
| c19_unbalanced_existing/config_04 | 3.6.3 | 19 | Rejection | id | PASS | 23 | yes |
| c20_fractional_spots/config_01 | 3.5.2 | 20200416 | Rounding | id | PASS | 23 | yes |
| c20_fractional_spots/config_01 | 3.6.3 | 20200416 | Rounding | id | PASS | 23 | yes |
| c20_fractional_spots/config_02 | 3.6.3 | 20200416 | Rejection | id | PASS | 23 | yes |
| ex_closed-arm-zero-spots/config_01 | 3.5.2 | 20200416 | Rounding | patient | PASS | 23 | yes |
| ex_closed-arm-zero-spots/config_01 | 3.6.3 | 20200416 | Rounding | patient | PASS | 23 | yes |
| ex_closed-arm-zero-spots/config_02 | 3.6.3 | 20200416 | Rejection | patient | PASS | 23 | yes |
| ex_more-spots-than-patients/config_01 | 3.5.2 | 20200416 | Rounding | patient | PASS | 23 | yes |
| ex_more-spots-than-patients/config_01 | 3.6.3 | 20200416 | Rounding | patient | PASS | 23 | yes |
| ex_more-spots-than-patients/config_02 | 3.6.3 | 20200416 | Rejection | patient | PASS | 23 | yes |
| ex_no-id-column/config_01 | 3.5.2 | 20200416 | Rounding | (none) | PASS | 23 | yes |
| ex_no-id-column/config_01 | 3.6.3 | 20200416 | Rounding | (none) | PASS | 23 | yes |
| ex_no-id-column/config_02 | 3.6.3 | 20200416 | Rejection | (none) | PASS | 23 | yes |
| ex_three-covariates-large/config_01 | 3.5.2 | 20200416 | Rounding | patient | PASS | 23 | yes |
| ex_three-covariates-large/config_01 | 3.6.3 | 20200416 | Rounding | patient | PASS | 23 | yes |
| ex_three-covariates-large/config_02 | 3.6.3 | 20200416 | Rejection | patient | PASS | 23 | yes |
| ex_two-covariates-waitlist/config_01 | 3.5.2 | 20200416 | Rounding | patient | PASS | 23 | yes |
| ex_two-covariates-waitlist/config_01 | 3.6.3 | 20200416 | Rounding | patient | PASS | 23 | yes |
| ex_two-covariates-waitlist/config_02 | 3.6.3 | 20200416 | Rejection | patient | PASS | 23 | yes |

131/131 configurations identical
