# reference.R -- runs the server logic of GroupTherapyPatientAllocationWebApp.Rmd without Shiny and writes
# every intermediate and final result, to verify the browser port (docs/app.js) exactly.
#
# Usage:  Rscript reference.R config.json outdir [path/to/GroupTherapyPatientRandomization.R]
# config.json: existing, new (CSV paths), spots ('Available spots' text), pid (patient ID column; "" = none),
#              seed, samplekind ("Rounding" | "Rejection"; only used on R >= 3.6.0)
#
# The original functions are sourced unchanged. Instrumented copies (marked ## CAPTURE) of
# generatePatientAllocation3(), sampleAllocation() and matchPositionsPatients() record the
# intermediate results; groupTherapyAllocate() is then run a second time with the ORIGINAL functions
# from the same seed and must give an identical result and RNG state (field "instrumented_identical").
suppressPackageStartupMessages({ library(tidyverse); library(jsonlite) })
options(warn = 1, width = 80)
args <- commandArgs(trailingOnly = TRUE)
cfg <- fromJSON(args[1])
outdir <- args[2]
src <- if (length(args) >= 3) args[3] else file.path(dirname(sub("--file=", "", grep("--file=", commandArgs(FALSE), value = TRUE)[1])), "..", "shiny", "app", "GroupTherapyPatientRandomization.R")
dir.create(outdir, showWarnings = FALSE, recursive = TRUE)
source(src)
`%||%` <- function(a, b) if (is.null(a)) b else a
hex <- function(x) ifelse(is.na(x), NA_character_, sprintf("%a", x))
out <- function(name, x) writeLines(toJSON(x, auto_unbox = TRUE, null = "null", na = "null", digits = NA), file.path(outdir, paste0(name, ".json")), useBytes = TRUE)
dfj <- function(d) {
  if (is.null(d)) return(NULL)
  d <- as.data.frame(d, stringsAsFactors = FALSE)
  list(names = names(d), class = unname(sapply(d, function(v) class(v)[1])),
       levels = lapply(d, function(v) if (is.factor(v)) levels(v) else NULL),
       values = lapply(d, function(v) if (is.double(v)) hex(v) else { r <- as.character(v); r }))
}
ftj <- function(f) list(row.vars = attr(f, "row.vars"), col.vars = attr(f, "col.vars"), dim = dim(f), data = as.vector(unclass(f)), type = typeof(f))
info <- list(R = R.version.string, dplyr = as.character(packageVersion("dplyr")), tibble = as.character(packageVersion("tibble")),
             locale = Sys.getlocale("LC_COLLATE"), icu = unname(capabilities("ICU")))
if (getRversion() >= "3.6.0") suppressWarnings(RNGkind(sample.kind = cfg$samplekind %||% "Rejection")) else if (identical(cfg$samplekind, "Rejection")) stop("Rejection needs R >= 3.6.0")
info$RNGkind <- RNGkind()

## ---- Shiny inputs -> val$ (observers of the Rmd) -------------------------------------------
input <- list(RandomSeed = cfg$seed, spots_k = cfg$spots, patient_id = cfg$pid %||% "")
val <- new.env()
val$rSeed <- input$RandomSeed            # 2nd observer: val$rSeed = input$RandomSeed (raw value)
val$predictability <- 0.8
val$dfExisting <- read.csv(cfg$existing)
val$dfNew <- read.csv(cfg$new)
txt <- input$spots_k
spots_ok <- all(grepl("\\w+\\s*=\\s*\\d", strsplit(txt, ",")[[1]]))
if (spots_ok) {
  e <- try(eval(parse(text = paste("c(", gsub("(\\w+)(\\s*=\\s*\\d+)", '"\\1"\\2', txt), ")"))), silent = TRUE)
  if (inherits(e, "try-error")) spots_ok <- FALSE else val$k <- e
}
out("inputs", list(info = info, existing = dfj(val$dfExisting), new = dfj(val$dfNew), spots_ok = spots_ok,
                   k = if (spots_ok) list(names = names(val$k), values = hex(unname(val$k))) else NULL,
                   spots_from_existing = if ("arm" %in% names(val$dfExisting)) paste(paste(unique(val$dfExisting$arm), " = 0"), collapse = ", ") else NULL))
if (!spots_ok) { out("result", list(error = "Error in 'Available spots'")); quit(save = "no") }

## ---- instrumented copies --------------------------------------------------------------------
cap <- new.env()
generatePatientAllocation3_cap = function(df, new, k, trace = FALSE) {
  K = c(k, wait = pmax(0, nrow(new) - sum(k)))
  levels_wait = c(levels(df$arm), "wait")
  nnew = nrow(new)
  newAlloc = cbind(new, arm = factor(sample(rep(names(K), K))[1:nnew], levels = levels_wait))
  cap$K <- list(names = names(K), values = hex(unname(K))); cap$levels_wait <- levels_wait   ## CAPTURE
  cap$initial_draw <- as.character(newAlloc$arm)                                              ## CAPTURE
  current_counts = ftable(transform(df,arm=factor(arm,levels=levels_wait)), col.vars = "arm")
  new_counts = ftable(newAlloc, col.vars = "arm")
  cap$current_counts <- ftj(current_counts); cap$new_counts_initial <- ftj(new_counts)        ## CAPTURE
  imb = ftable_imbalance(current_counts + new_counts)
  non_zero_rows = sample(which(rowSums(new_counts) > 0)) # randomize to prevent order effects
  cap$which_nonzero <- which(rowSums(new_counts) > 0); cap$non_zero_rows <- non_zero_rows       ## CAPTURE
  cap$iterations <- list()                                                                    ## CAPTURE
  decr = 1
  all_counts = list(list(imb = imb, counts = new_counts))
  while(decr > 0) {
    best_counts_sofar = new_counts
    best_imb = imb
    keep_new_counts = new_counts
    all_considered = vector("list", ncol(new_counts)^2 * length(non_zero_rows)^2)
    k=0
    for (i in non_zero_rows)
      for (j in non_zero_rows) {
        if (i >= j) next
        for (col_from in 1:ncol(new_counts))
          for (col_to in 1:ncol(new_counts)) {
            new_counts = keep_new_counts
            if (col_to == col_from) next
            if (new_counts[i, col_from] < 1) next
            if (new_counts[j, col_to  ] < 1) next
            new_counts[i, col_from] = new_counts[i, col_from] - 1
            new_counts[i, col_to  ] = new_counts[i, col_to  ] + 1
            new_counts[j, col_to  ] = new_counts[j, col_to  ] - 1
            new_counts[j, col_from] = new_counts[j, col_from] + 1
            new_imb = ftable_imbalance(current_counts + new_counts)
            if (new_imb < best_imb) {
              best_counts_sofar = new_counts
              best_imb = new_imb
            }
            k = k+1
            all_considered[[k]] = list(imb = new_imb, counts = new_counts)
          }
      }
    all_counts = c(all_counts, Filter(function(x) length(x)>0, all_considered))
    cap$iterations[[length(cap$iterations) + 1]] <- list(imb_before = hex(imb), best_imb = hex(best_imb), considered = k)  ## CAPTURE
    new_counts = best_counts_sofar
    decr = imb - best_imb
    imb = best_imb
  }
  structure(new_counts, trace = all_counts)
}
sampleAllocation_cap = function(allocation, a=exp(-.2231436)) {
  f = function(x, a=.8, e1=c(1,rep(0,length(x)-1))) a * e1 + (1-a) * (1-e1)/sum(1-e1)
  sample_from = function(x, size, replace = FALSE, prob = NULL) if (length(x) == 1) rep(x, size) else sample(x, size, replace, prob)
  imb  =  sapply(attr(allocation, 'trace'),function(x) x$imb)
  x = sort(unique(round(imb, 10)))
  cap$rounded <- hex(round(imb, 10)); cap$unique_imb <- hex(x)                                  ## CAPTURE
  if (length(x) == 1) { cap$sampled_index <- 1; return(attr(allocation, 'trace')[1]) }
  breaks = c(0, x + min(diff(x))/2, Inf)
  y = cut(x, breaks)
  p.y = f(x, a)
  g = cut(imb, breaks)
  k = sample_from(y, 1, prob = p.y)
  i = sample_from(which(g == k),1)
  cap$breaks <- hex(breaks); cap$p_y <- hex(p.y); cap$g <- as.integer(g); cap$class_sampled <- as.integer(k)   ## CAPTURE
  cap$class_members <- sum(g == k, na.rm = TRUE); cap$sampled_index <- i                         ## CAPTURE
  attr(allocation, 'trace')[i]
}
matchPositionsPatients_cap = function(allocation, new) {
  draw = allocation
  positions = as.data.frame(draw) %>%
    as_tibble %>% filter(Freq > 0) %>%
    {x = .; x[rep(1:nrow(x), x$Freq),]} %>%
    arrange_all() %>%
    rownames_to_column()
  patients = new %>%
    rownames_to_column() %>%
    rename(patient_id = rowname) %>%
    arrange_at(vars(-patient_id)) %>%
    rownames_to_column()
  placement = full_join(patients, positions, intersect(names(patients),names(positions))) %>% select(-rowname, -Freq)
  cap$positions <- dfj(positions); cap$patients <- dfj(patients); cap$placement <- dfj(placement)   ## CAPTURE
  cap$group_sizes <- placement %>% group_by_at(vars(-patient_id,-arm)) %>% group_size()             ## CAPTURE
  placement %>% group_by_at(vars(-patient_id,-arm)) %>% mutate(patient_id = sample(patient_id)) %>% arrange(patient_id)
}
gta_cap <- groupTherapyAllocate
environment(gta_cap) <- environment()
body(gta_cap) <- do.call(substitute, list(body(groupTherapyAllocate), list(
  generatePatientAllocation3 = quote(generatePatientAllocation3_cap),
  sampleAllocation = quote(sampleAllocation_cap), matchPositionsPatients = quote(matchPositionsPatients_cap))))
gpa_inner <- generatePatientAllocation3_cap
generatePatientAllocation3_cap <- function(df, new, k, trace = FALSE) {
  r <- gpa_inner(df, new, k, trace)
  tr <- attr(r, "trace")
  cap$trace <- list(imb = hex(sapply(tr, function(x) x$imb)), counts = lapply(tr, function(x) as.vector(unclass(x$counts))))
  cap$final_counts <- as.vector(unclass(r)); cap$covariate_levels <- lapply(new, levels)
  r
}
sa_inner <- sampleAllocation_cap
sampleAllocation_cap <- function(allocation, a) { r <- sa_inner(allocation, a); cap$sampled_counts <- as.vector(unclass(r[[1]]$counts)); r }

## ---- observer: set.seed(val$rSeed); val$alloc = tryCatch(groupTherapyAllocate(...), error = traceback) --------
run <- function(fun) {
  set.seed(val$rSeed)
  tb <- NULL
  res <- withCallingHandlers(tryCatch(fun(val$dfExisting, val$dfNew, val$k, input$patient_id, val$predictability),
                  error = function(e) e), warning = function(w) { cap$warnings <- c(cap$warnings, conditionMessage(w)); invokeRestart("muffleWarning") })
  list(res = res, seed = .Random.seed)
}
r1 <- run(function(df, new, k, pid, pr) gta_cap(df, new, k, pid, pr))
r2 <- run(function(df, new, k, pid, pr) groupTherapyAllocate(df, new, k, pid, pr))
identical_ok <- identical(r1$seed, r2$seed) && (if (inherits(r2$res, "error")) identical(conditionMessage(r1$res), conditionMessage(r2$res)) else identical(r1$res, r2$res))
res <- r2$res
caps <- as.list(cap)
if (inherits(res, "error")) {
  tb <- capture.output(traceback(res))
  out("result", list(error = conditionMessage(res), call = paste(deparse(conditionCall(res)), collapse = "\n"), traceback = tb,
                     rng_state = r2$seed[-1], instrumented_identical = identical_ok, warnings = cap$warnings, cap = caps))
} else {
  df <- attr(res, "combined_patients")
  df <- as.data.frame(as.matrix(as.data.frame(df)))
  write.csv(df, file.path(outdir, "download.csv"), quote = 1:ncol(df), row.names = FALSE)   # downloadHandler content
  out("result", list(alloc = list(names = names(res), rows = lapply(seq_len(nrow(res)), function(i) unname(as.list(as.data.frame(res, stringsAsFactors = FALSE)[i, ])))),
                     alloc_df = dfj(res), combined = dfj(attr(res, "combined_patients")), rng_state = r2$seed[-1],
                     instrumented_identical = identical_ok, warnings = cap$warnings, cap = caps))
}
## ---- Debug tab (renderPrint) ------------------------------------------------------------------
val$patient_id <- if (nzchar(input$patient_id)) input$patient_id else NULL
dbg <- capture.output({
  new = val$dfNew; df = val$dfExisting; k = val$k
  cat("\nExisting patients table\n",rep("=",23), "\n", sep="")
  print(df)
  cat("\n\nNew patients\n",rep("=",12), "\n", sep="")
  print(new)
  cat("\nColumn with patient ID:", val$patient_id, "\n")
  cat("\n\nAvailable spots\n",rep("=",15), "\n", sep="")
  print(k)
  cat("\n\nComputed allocation\n", rep("=",19), "\n", sep = "")
  cat("Randomization Seed: ", val$rSeed, "\n")
  set.seed(val$rSeed)
  print(tryCatch(
    groupTherapyAllocate(df, new, k, input$patient_id, val$predictability),
    error = traceback
  ))
})
writeLines(dbg, file.path(outdir, "debug.txt"))
