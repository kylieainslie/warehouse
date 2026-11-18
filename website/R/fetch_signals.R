# fetch_signals.R
# Fetch maintenance and usage signals (last release, downloads, reverse
# dependencies) for CRAN packages. R-universe scores and GitHub stars only
# cover a small share of packages, so without these most cards show nothing
# useful about whether a package is maintained or widely used.

library(httr2)
library(jsonlite)
library(dplyr)

CRAN_DB_URL      <- "https://cran.r-project.org/web/packages/packages.rds"
CRANLOGS_URL     <- "https://cranlogs.r-pkg.org/downloads/total/last-month"
SIGNALS_PATH     <- file.path(getwd(), "data", "signals.json")
CRANLOGS_BATCH   <- 200

# Reverse dependency fields that mean "this package needs it to work"
# (Suggests and Enhances are optional, so they are not counted)
REVDEP_FIELDS <- c("Reverse depends", "Reverse imports", "Reverse linking to")

#' Count unique packages listed across comma-separated dependency fields
#' @param ... Character vectors of comma-separated package names (NA allowed)
#' @return Integer vector of counts
count_revdeps <- function(...) {
  fields <- list(...)
  vapply(seq_along(fields[[1]]), function(i) {
    names <- unlist(lapply(fields, function(f) strsplit(f[i] %||% "", ",")[[1]]))
    names <- trimws(names)
    length(unique(names[names != "" & !is.na(names)]))
  }, integer(1))
}

#' Fetch release dates and reverse dependency counts from CRAN
#' @param url URL of CRAN's packages.rds
#' @return A tibble with package_name, cran_version, published, revdeps
fetch_cran_metadata <- function(url = CRAN_DB_URL) {
  message("Fetching CRAN package metadata...")

  temp_file <- tempfile(fileext = ".rds")
  on.exit(unlink(temp_file))
  download.file(url, temp_file, quiet = TRUE)
  cran_db <- as.data.frame(readRDS(temp_file), stringsAsFactors = FALSE)

  # Older snapshots may lack some reverse dependency columns
  for (field in REVDEP_FIELDS) {
    if (!field %in% names(cran_db)) cran_db[[field]] <- NA_character_
  }

  result <- tibble(
    package_name = cran_db$Package,
    cran_version = cran_db$Version,
    published = substr(cran_db$Published, 1, 10),
    revdeps = count_revdeps(cran_db[["Reverse depends"]],
                            cran_db[["Reverse imports"]],
                            cran_db[["Reverse linking to"]])
  ) |>
    distinct(package_name, .keep_all = TRUE)

  message(sprintf("  Got metadata for %d CRAN packages", nrow(result)))
  result
}

#' Fetch last-month download counts from cranlogs
#' @param package_names Character vector of CRAN package names
#' @param batch_size Number of packages per request
#' @return A tibble with package_name, downloads (packages in failed batches are omitted)
fetch_cran_downloads <- function(package_names, batch_size = CRANLOGS_BATCH) {
  message(sprintf("Fetching downloads for %d packages from cranlogs...", length(package_names)))

  batches <- split(package_names, ceiling(seq_along(package_names) / batch_size))
  failed <- 0

  results <- lapply(batches, function(batch) {
    tryCatch({
      resp <- request(CRANLOGS_URL) |>
        req_url_path_append(paste(batch, collapse = ",")) |>
        req_timeout(60) |>
        req_retry(max_tries = 3) |>
        req_perform()

      body <- fromJSON(resp_body_string(resp), simplifyVector = FALSE)
      tibble(
        package_name = vapply(body, function(x) x$package %||% NA_character_, character(1)),
        downloads = vapply(body, function(x) as.integer(x$downloads %||% NA), integer(1))
      )
    }, error = function(e) {
      failed <<- failed + 1
      tibble(package_name = character(0), downloads = integer(0))
    })
  })

  if (failed > 0) {
    warning(sprintf("%d of %d cranlogs batches failed", failed, length(batches)))
  }

  result <- bind_rows(results) |>
    filter(!is.na(package_name)) |>
    distinct(package_name, .keep_all = TRUE)

  message(sprintf("  Got downloads for %d packages", nrow(result)))
  result
}

#' Combine metadata and downloads into a named list keyed by package name
#' @param metadata Tibble from fetch_cran_metadata()
#' @param downloads Tibble from fetch_cran_downloads()
#' @return Named list: package_name -> list(cran_version, published, downloads, revdeps)
build_signals <- function(metadata, downloads) {
  combined <- left_join(metadata, downloads, by = "package_name")

  signals <- lapply(seq_len(nrow(combined)), function(i) {
    row <- combined[i, ]
    entry <- list(
      cran_version = if (is.na(row$cran_version)) NULL else row$cran_version,
      published = if (is.na(row$published)) NULL else row$published,
      downloads = if (is.na(row$downloads)) NULL else row$downloads,
      revdeps = row$revdeps
    )
    Filter(Negate(is.null), entry)
  })
  names(signals) <- combined$package_name
  signals
}

#' Fetch all signals and write them to signals.json
#' Keeps the existing file if CRAN can't be reached, so one bad week doesn't
#' wipe the signals from every card.
#' @param path Output path
#' @param cran_url URL of CRAN's packages.rds
run_signals_fetch <- function(path = SIGNALS_PATH, cran_url = CRAN_DB_URL) {
  metadata <- tryCatch(fetch_cran_metadata(cran_url), error = function(e) {
    warning(sprintf("Failed to fetch CRAN metadata: %s", e$message))
    NULL
  })

  if (is.null(metadata) || nrow(metadata) == 0) {
    warning("No CRAN metadata; keeping existing signals.json")
    return(invisible(NULL))
  }

  downloads <- fetch_cran_downloads(metadata$package_name)
  signals <- build_signals(metadata, downloads)

  output <- list(
    generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    packages = signals
  )

  dir.create(dirname(path), showWarnings = FALSE, recursive = TRUE)
  write_json(output, path, auto_unbox = TRUE)

  message(sprintf("Wrote signals for %d packages to %s (%.1f MB)",
                  length(signals), path, file.size(path) / 1024^2))
  invisible(path)
}

# Null coalescing operator (handles NA and empty values)
`%||%` <- function(x, y) {
  if (is.null(x) || length(x) == 0) return(y)
  if (length(x) == 1 && is.na(x)) return(y)
  x
}

# Run if called directly
if (sys.nframe() == 0) {
  run_signals_fetch()
}
