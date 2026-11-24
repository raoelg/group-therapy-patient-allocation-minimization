# Second pass: reinstall every locked package, dependencies first, so no package
# is ever built while a newer version of one of its dependencies is installed.
lines <- readLines("/tmp/packrat.lock")
pk <- sub("^Package: ", "", grep("^Package: ", lines, value = TRUE))
vr <- sub("^Version: ", "", grep("^Version: ", lines, value = TRUE))
lock <- setNames(vr, pk)
lock <- lock[!names(lock) %in% c(rownames(installed.packages(priority = "base")), "packrat")]
ip <- installed.packages(lib.loc = .libPaths()[1])
deps <- lapply(names(lock), function(p) {
  f <- paste(ip[p, c("Depends", "Imports", "LinkingTo")], collapse = ",")
  d <- trimws(sub("\\(.*", "", strsplit(gsub("\n", " ", f), ",")[[1]]))
  intersect(d, setdiff(names(lock), p))
})
names(deps) <- names(lock)
ord <- character(0)
while (length(ord) < length(lock)) {
  ready <- setdiff(names(deps)[vapply(deps, function(d) all(d %in% ord), TRUE)], ord)
  if (!length(ready)) stop("dependency cycle")
  ord <- c(ord, sort(ready))
}
message("Install order: ", paste(ord, collapse = " "))
for (p in ord) {
  f <- sprintf("%s_%s.tar.gz", p, lock[[p]])
  urls <- c(sprintf("https://cran.r-project.org/src/contrib/Archive/%s/%s", p, f),
            sprintf("https://cran.r-project.org/src/contrib/%s", f))
  dest <- file.path(tempdir(), f)
  ok <- FALSE
  for (u in urls) if (!ok) ok <- tryCatch(download.file(u, dest, quiet = TRUE) == 0, error = function(e) FALSE, warning = function(w) FALSE)
  if (!ok) stop("cannot download ", f)
  install.packages(dest, repos = NULL, type = "source")
  if (package_version(as.character(packageVersion(p, lib.loc = .libPaths()[1]))) != package_version(lock[[p]]))
    stop("version mismatch after reinstall: ", p)
}
message("Reinstalled all ", length(ord), " packages in dependency order")
