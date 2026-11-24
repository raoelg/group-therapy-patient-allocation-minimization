# gen.R -- generates synthetic test cases for reference.R / compare.js
# usage: Rscript gen.R <testsdir>      (writes <testsdir>/cases/<case>/{existing.csv,new.csv,config_<j>.json})
# All data are fictitious: generated IDs and random covariate values only.
suppressPackageStartupMessages(library(jsonlite))
root <- commandArgs(trailingOnly = TRUE)[1]
dir.create(file.path(root, "cases"), showWarnings = FALSE, recursive = TRUE)
set.seed(2020)

covs_all <- list(
  sex = c("female", "male"),
  agegroup = c("18-30", "31-50", "51+"),
  diagnosis = c("anxiety", "depression", "PTSD"),
  severity = 1:3,               # integer covariate
  site = 1:12,                  # integer covariate with >= 10 levels (numeric vs alphabetical order)
  label = c("a-b", "A", "b", "_x", "B c"),  # mixed case / punctuation (collation)
  employed = c(TRUE, FALSE),    # logical covariate
  dose = c(0.5, 1.25, 2)        # double covariate
)
rcov <- function(nm, n, prob = NULL) sample(covs_all[[nm]], n, replace = TRUE, prob = prob)
mkdf <- function(n, covs, prob = list()) {
  d <- data.frame(row.names = seq_len(n))
  for (nm in covs) d[[nm]] <- rcov(nm, n, prob[[nm]])
  d
}
both <- function(seeds, ...) unlist(lapply(seeds, function(s) list(
  list(seed = s, samplekind = "Rounding", ...), list(seed = s, samplekind = "Rejection", ...))), recursive = FALSE)

make_case <- function(name, covs, nexist, nnew, arms, spots, configs, id = c("both", "new", "none"),
                      idstyle = c("num", "chr"), new_covs = covs, new_extra = NULL, arm_first = FALSE, prob = list(),
                      existing_arm_prob = NULL) {
  id <- match.arg(id); idstyle <- match.arg(idstyle)
  ex <- mkdf(nexist, covs, prob)
  ex$arm <- sample(arms, nexist, replace = TRUE, prob = existing_arm_prob)
  nw <- mkdf(nnew, covs, prob)
  if (!is.null(new_extra)) for (r in seq_along(new_extra)) nw[new_extra[[r]]$row, new_extra[[r]]$col] <- new_extra[[r]]$value
  nw <- nw[, new_covs, drop = FALSE]
  mkid <- function(n, offset) if (idstyle == "num") offset + seq_len(n) else sprintf("P%03d", offset + seq_len(n))
  if (id %in% c("both")) ex <- cbind(id = mkid(nexist, 1000), ex)
  if (id %in% c("both", "new")) nw <- cbind(id = mkid(nnew, 1000 + nexist), nw)
  if (arm_first) ex <- ex[, c("arm", setdiff(names(ex), "arm"))]
  dir <- file.path(root, "cases", name); dir.create(dir, showWarnings = FALSE)
  write.csv(ex, file.path(dir, "existing.csv"), row.names = FALSE)
  write.csv(nw, file.path(dir, "new.csv"), row.names = FALSE)
  for (j in seq_along(configs)) {
    cf <- configs[[j]]
    cf$existing <- normalizePath(file.path(dir, "existing.csv")); cf$new <- normalizePath(file.path(dir, "new.csv"))
    if (is.null(cf$spots)) cf$spots <- spots
    if (is.null(cf$pid)) cf$pid <- if (id == "none") names(nw)[1] else "id"   # the app selects the first column by default
    writeLines(toJSON(cf, auto_unbox = TRUE, null = "null"), file.path(dir, sprintf("config_%02d.json", j)))
  }
}

make_case("c01_one_cov_more_spots", "sex", 20, 6, c("A", "B", "C"), "A = 3, B = 2, C = 2", both(c(20200416, 1)))
make_case("c02_two_cov_wait", c("sex", "agegroup"), 30, 12, c("cntrl", "expA", "expB"), "cntrl = 3, expA = 3, expB = 2", both(c(20200416, 7)))
make_case("c03_three_cov_exact", c("sex", "diagnosis", "severity"), 40, 15, c("cntrl", "expA", "expB"), "cntrl = 5, expA = 5, expB = 5", both(c(20200501, 99)))
make_case("c04_zero_spot_arm", c("sex", "agegroup"), 25, 5, c("A", "B", "C"), "A = 4, B = 0, C = 3", both(c(20200416, 3)))
make_case("c05_no_id_column", c("sex", "agegroup"), 20, 8, c("expA", "expB"), "expA = 4, expB = 4",
          c(both(20200416), both(20200416, pid = "")), id = "none")
make_case("c06_id_only_in_new", c("sex", "diagnosis"), 24, 9, c("A", "B"), "A = 5, B = 5", both(c(20200416, 11)), id = "new")
make_case("c07_levels_collation", c("site", "label"), 40, 10, c("grpA", "grpB", "grpC"), "grpA = 4, grpB = 3, grpC = 3", both(c(20200416, 5)))
make_case("c08_cov_order_differs", c("sex", "agegroup"), 30, 10, c("A", "B"), "A = 5, B = 5", both(c(20200416, 8)),
          new_covs = c("agegroup", "sex"))
make_case("c09_new_level_not_in_existing", c("sex", "diagnosis"), 15, 8, c("A", "B"), "A = 4, B = 4", both(c(20200416, 9)),
          prob = list(diagnosis = c(.5, .5, 0)), new_extra = list(list(row = 3, col = "diagnosis", value = "PTSD"), list(row = 6, col = "diagnosis", value = "PTSD")))
make_case("c10_large", c("sex", "agegroup", "diagnosis"), 120, 30, c("cntrl", "expA", "expB", "expC"), "cntrl = 8, expA = 8, expB = 7, expC = 7", both(c(20200416, 2020)))
make_case("c11_spots_from_existing_all_wait", c("sex", "agegroup"), 20, 6, c("A", "B"), "A  = 0, B  = 0", both(20200416))
make_case("c12_error_k_names", c("sex"), 20, 6, c("A", "B"), "expA = 3, expB = 1", both(20200416))
make_case("c13_logical_double_covs", c("employed", "dose"), 30, 9, c("A", "B", "C"), "A = 3, B = 3, C = 2", both(c(20200416, 13)), arm_first = TRUE)
make_case("c14_single_new_patient", c("sex", "agegroup"), 20, 1, c("A", "B"), "A = 1, B = 1", both(c(20200416, 14, 15)))
make_case("c15_one_stratum_two_patients", c("sex"), 20, 2, c("A", "B"), "A = 1, B = 2", both(c(20200416, 16)),
          prob = list(sex = c(0, 1)))
make_case("c16_char_ids_many_spots", c("sex", "agegroup"), 30, 7, c("A", "B", "C"), "A = 5, B = 5, C = 5", both(c(20200416, 17)), idstyle = "chr")
make_case("c17_seeds", c("sex", "diagnosis"), 25, 10, c("A", "B"), "A = 5, B = 3", both(c(-1, 0, 2147483647, 123456789)))
make_case("c18_error_extra_column", c("sex"), 10, 4, c("A", "B"), "A = 2, B = 2",
          list(list(seed = 1, samplekind = "Rounding", pid = "")), id = "new")  # id column in new only, pid = "": error
make_case("c19_unbalanced_existing", c("sex", "agegroup"), 40, 10, c("A", "B", "C"), "A = 4, B = 3, C = 3", both(c(20200416, 19)),
          existing_arm_prob = c(.6, .3, .1))
make_case("c20_fractional_spots", c("sex"), 12, 5, c("A", "B"), "A = 2.5, B = 1", both(20200416))
