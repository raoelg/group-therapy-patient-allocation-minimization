# make_examples.R -- writes the synthetic example data in docs/examples/<name>/{existing.csv,new.csv,spots.txt}
# usage: Rscript make_examples.R <docs/examples>     (all data are fictitious: random values, generated IDs)
root <- commandArgs(trailingOnly = TRUE)[1]
set.seed(42)
lv <- list(sex = c("female", "male"), agegroup = c("18-30", "31-50", "51+"), diagnosis = c("anxiety", "depression", "PTSD"),
           medication = c("no", "yes"))
mk <- function(n, covs, arms = NULL, prob = NULL, idstart = 1, id = TRUE) {
  d <- data.frame(row.names = seq_len(n))
  if (id) d$patient <- sprintf("GT-%04d", idstart + seq_len(n) - 1)
  for (v in covs) d[[v]] <- sample(lv[[v]], n, TRUE)
  if (!is.null(arms)) d$arm <- sample(arms, n, TRUE, prob)
  d
}
ex <- function(name, existing, new, spots, note) {
  dir <- file.path(root, name); dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  write.csv(existing, file.path(dir, "existing.csv"), row.names = FALSE)
  write.csv(new, file.path(dir, "new.csv"), row.names = FALSE)
  writeLines(c(spots, "", note), file.path(dir, "spots.txt"))
}
ex("two-covariates-waitlist", mk(36, c("sex", "agegroup"), c("cntrl", "expA", "expB")), mk(10, c("sex", "agegroup"), idstart = 37),
   "cntrl = 3, expA = 3, expB = 2", "10 new patients, 8 spots: 2 patients are put on the 'wait' list. Patient ID column: patient.")
ex("more-spots-than-patients", mk(24, c("sex", "medication"), c("A", "B", "C")), mk(5, c("sex", "medication"), idstart = 25),
   "A = 4, B = 4, C = 4", "5 new patients, 12 spots. Note: which arms receive the 5 patients is decided by the initial random draw only.")
ex("three-covariates-large", mk(120, c("sex", "agegroup", "diagnosis"), c("cntrl", "expA", "expB", "expC")),
   mk(24, c("sex", "agegroup", "diagnosis"), idstart = 121), "cntrl = 6, expA = 6, expB = 6, expC = 6",
   "120 existing and 24 new patients, 3 covariates (18 strata), 4 arms, exactly as many spots as new patients.")
ex("closed-arm-zero-spots", mk(30, c("sex", "agegroup"), c("A", "B", "C"), prob = c(.3, .3, .4)), mk(6, c("sex", "agegroup"), idstart = 31),
   "A = 3, B = 3, C = 0", "Arm C is full (0 spots) but its existing patients still count in the balance.")
ex("no-id-column", mk(20, c("sex", "agegroup"), c("expA", "expB"), id = FALSE), mk(6, c("sex", "agegroup"), id = FALSE),
   "expA = 3, expB = 3", "No patient ID column. In the original app the first column (sex) is then selected as 'patient ID' and silently dropped from the covariates; in the JS version choose '(none)' to keep it.")
