# Install all packages of packrat.lock from local source directories (src/<package>, see
# fetch_github_sources.sh), dependencies first, so no package is ever built while an older or newer
# version of one of its dependencies is installed (same idea as reinstall_ordered.R, but offline).
lines <- readLines("/tmp/packrat.lock")
pk <- sub("^Package: ", "", grep("^Package: ", lines, value = TRUE))
vr <- sub("^Version: ", "", grep("^Version: ", lines, value = TRUE))
lock <- setNames(vr, pk)
lock <- lock[!names(lock) %in% c(rownames(installed.packages(priority = "base")), "packrat")]
src <- "/tmp/src"
deps <- lapply(names(lock), function(p) {
  d <- read.dcf(file.path(src, p, "DESCRIPTION"), fields = c("Depends", "Imports", "LinkingTo"))
  d <- paste(d[!is.na(d)], collapse = ",")
  d <- trimws(sub("\\(.*", "", strsplit(gsub("\n", " ", d), ",")[[1]]))
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
lib <- .libPaths()[1]
for (p in ord) {
  st <- system2(file.path(R.home("bin"), "R"), c("CMD", "INSTALL", "--no-docs", "--no-multiarch", paste0("--library=", lib), file.path(src, p)))
  if (st != 0) stop("installation failed: ", p)
  if (package_version(as.character(packageVersion(p, lib.loc = lib))) != package_version(lock[[p]]))
    stop("version mismatch after install: ", p)
}
message("Installed all ", length(ord), " packages of packrat.lock in dependency order")
