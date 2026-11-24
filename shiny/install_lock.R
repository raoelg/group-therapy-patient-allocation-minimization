snap <- "https://packagemanager.posit.co/cran/2020-04-16"
options(repos = c(CRAN = snap), Ncpus = 2)
lines <- readLines("/tmp/packrat.lock")
pk <- sub("^Package: ", "", grep("^Package: ", lines, value = TRUE))
vr <- sub("^Version: ", "", grep("^Version: ", lines, value = TRUE))
lock <- setNames(vr, pk)
base <- rownames(installed.packages(priority = "base"))
lock <- lock[!names(lock) %in% c(base, "packrat")]
install.packages(names(lock))
cur <- function(p) tryCatch(as.character(packageVersion(p, lib.loc = .libPaths()[1])), error = function(e) NA)
same <- function(a, b) !is.na(a) && package_version(a) == package_version(b)
for (p in names(lock)) {
  if (!same(cur(p), lock[[p]])) {
    message("Pinning ", p, " ", cur(p), " -> ", lock[[p]])
    url <- sprintf("https://cran.r-project.org/src/contrib/Archive/%s/%s_%s.tar.gz", p, p, lock[[p]])
    install.packages(url, repos = NULL, type = "source")
  }
}
bad <- names(lock)[mapply(function(p, v) !same(cur(p), v), names(lock), lock)]
if (length(bad)) stop("Version mismatch: ", paste(bad, collapse = ", "))
message("All ", length(lock), " packages match packrat.lock")
