# stress.R -- many seeds per case: final allocation (pasted) + RNG state checksum, for stress.js
# usage: Rscript stress.R <out.json> <nseeds> <case dirs...>     (pid "id" if present, else "")
suppressPackageStartupMessages({ library(tidyverse); library(jsonlite) })
a <- commandArgs(trailingOnly = TRUE); out <- a[1]; ns <- as.integer(a[2]); cases <- a[-(1:2)]
source("../shiny/app/GroupTherapyPatientRandomization.R")
res <- list()
for (cs in cases) {
  ex <- read.csv(file.path(cs, "existing.csv")); nw <- read.csv(file.path(cs, "new.csv"))
  cf <- fromJSON(file.path(cs, "config_01.json")); txt <- cf$spots
  k <- eval(parse(text = paste("c(", gsub("(\\w+)(\\s*=\\s*\\d+)", '"\\1"\\2', txt), ")")))
  for (s in seq_len(ns)) {
    seed <- s * 7919 - 1000
    set.seed(seed)
    r <- tryCatch(suppressMessages(groupTherapyAllocate(ex, nw, k, cf$pid, 0.8)), error = function(e) e)
    al <- if (inherits(r, "error")) paste("ERROR", conditionMessage(r)) else paste(apply(as.matrix(r), 1, paste, collapse = ","), collapse = ";")
    res[[length(res) + 1]] <- list(case = basename(cs), seed = seed, alloc = al, rng = sum(as.numeric(.Random.seed[-1]) * seq_along(.Random.seed[-1])))
  }
}
writeLines(toJSON(res, auto_unbox = TRUE, digits = NA), out)
