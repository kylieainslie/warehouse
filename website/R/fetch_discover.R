# fetch_discover.R
# Fetch trending, new, and rising packages from R-universe for the Discover section

library(httr2)
library(jsonlite)
library(dplyr)

# R-universe global stats API
RUNIVERSE_STATS_URL <- "https://r-universe.dev/stats/descriptions"

# Null coalescing operator (handles NA and empty values)
`%||%` <- function(x, y) {
  if (is.null(x) || length(x) == 0) return(y)
  if (length(x) == 1 && is.na(x)) return(y)
  x
}

#' Fetch package stats from R-universe global API
#' @param limit Number of packages to fetch
#' @return A list of package data
fetch_package_stats <- function(limit = 200) {
  message("Fetching package stats from R-universe...")

  url <- sprintf("%s?limit=%d", RUNIVERSE_STATS_URL, limit)

  tryCatch({
    resp <- request(url) |>
      req_headers(Accept = "application/json") |>
      req_timeout(60) |>
      req_perform()

    # R-universe returns newline-delimited JSON (NDJSON), parse each line
    body_text <- resp_body_string(resp)
    lines <- strsplit(body_text, "\n")[[1]]
    lines <- lines[nchar(trimws(lines)) > 0]  # Remove empty lines

    data <- lapply(lines, function(line) {
      fromJSON(line, simplifyVector = FALSE)
    })

    message(sprintf("  Fetched %d packages", length(data)))
    data

  }, error = function(e) {
    warning(sprintf("Failed to fetch package stats: %s", e$message))
    list()
  })
}

#' Safely extract a numeric value from potentially complex structures
#' @param x A value that might be NULL, NA, a list, or numeric
#' @param default Default value to return
#' @return Integer value
safe_int <- function(x, default = 0L) {
  if (is.null(x)) return(default)
  if (is.list(x)) {
    # Sometimes _downloads is a list like {count: 123, source: "..."}
    if (!is.null(x$count)) return(as.integer(x$count))
    # Or it might be a vector
    x <- x[[1]]
  }
  if (length(x) == 0) return(default)
  result <- suppressWarnings(as.integer(x[1]))
  if (is.na(result)) default else result
}

#' Extract relevant fields from a package for the discover section
#' @param pkg Package data from API
#' @return A simplified list for JSON export
extract_package_info <- function(pkg) {
  # Get universe name for URL construction
  user <- pkg$`_user` %||% pkg$`_owner` %||% ""
  package_name <- pkg$Package %||% ""

  # Skip if no package name
  if (package_name == "") return(NULL)

  list(
    name = package_name,
    title = pkg$Title %||% "",
    description = substr(pkg$Description %||% "", 1, 200),  # Truncate long descriptions
    version = pkg$Version %||% "",
    stars = safe_int(pkg$`_stars`, 0L),
    downloads = safe_int(pkg$`_downloads`, 0L),
    score = as.numeric(pkg$`_score` %||% 0),
    usedby = safe_int(pkg$`_usedby`, 0L),
    published = pkg$`Date/Publication` %||% pkg$`_published` %||% "",
    created = pkg$`_created` %||% "",
    maintainer = pkg$Maintainer %||% "",
    url = sprintf("https://%s.r-universe.dev/%s", user, package_name),
    user = user
  )
}

#' Parse date string to POSIXct for sorting
#' @param date_str Date string in various formats
#' @return POSIXct or NA
parse_date_safe <- function(date_str) {
  if (is.null(date_str) || is.na(date_str) || date_str == "") {
    return(as.POSIXct(NA))
  }

  # Try common date formats
  formats <- c(
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d",
    "%Y-%m-%dT%H:%M:%SZ",
    "%Y-%m-%dT%H:%M:%S"
  )

  for (fmt in formats) {
    result <- tryCatch(
      as.POSIXct(date_str, format = fmt, tz = "UTC"),
      error = function(e) NA
    )
    if (!is.na(result)) return(result)
  }

  as.POSIXct(NA)
}

#' Get trending packages (highest downloads)
#' @param packages List of package data
#' @param n Number to return
#' @return List of top packages
get_trending <- function(packages, n = 12) {
  message("  Computing trending packages (by downloads)...")

  # Sort by downloads
  downloads <- sapply(packages, function(p) safe_int(p$`_downloads`, 0L))
  top_indices <- order(downloads, decreasing = TRUE)[1:min(n * 2, length(packages))]

  # Extract info and filter out NULLs
  results <- lapply(packages[top_indices], extract_package_info)
  results <- Filter(Negate(is.null), results)
  head(results, n)
}

#' Get new packages (most recently published)
#' @param packages List of package data
#' @param n Number to return
#' @return List of newest packages
get_new <- function(packages, n = 12) {
  message("  Computing new packages (by publish date)...")

  # Parse dates and sort
  dates <- sapply(packages, function(p) {
    date_str <- p$`Date/Publication` %||% p$`_published` %||% ""
    as.numeric(parse_date_safe(date_str))
  })

  # Filter out NA dates and sort
  valid_indices <- which(!is.na(dates))
  if (length(valid_indices) == 0) {
    message("    Warning: No valid dates found, falling back to first packages")
    results <- lapply(packages[1:min(n * 2, length(packages))], extract_package_info)
    results <- Filter(Negate(is.null), results)
    return(head(results, n))
  }

  sorted_valid <- valid_indices[order(dates[valid_indices], decreasing = TRUE)]
  top_indices <- sorted_valid[1:min(n * 2, length(sorted_valid))]

  # Extract info and filter out NULLs
  results <- lapply(packages[top_indices], extract_package_info)
  results <- Filter(Negate(is.null), results)
  head(results, n)
}

#' Get rising stars (highest stars)
#' @param packages List of package data
#' @param n Number to return
#' @return List of top starred packages
get_rising <- function(packages, n = 12) {
  message("  Computing rising stars (by GitHub stars)...")

  # Sort by stars
  stars <- sapply(packages, function(p) safe_int(p$`_stars`, 0L))
  top_indices <- order(stars, decreasing = TRUE)[1:min(n * 2, length(packages))]

  # Extract info and filter out NULLs
  results <- lapply(packages[top_indices], extract_package_info)
  results <- Filter(Negate(is.null), results)
  head(results, n)
}

#' Main function to fetch and export discover data
#' @param output_path Path to save the JSON file
#' @return The discover data list
run_discover_fetch <- function(output_path = file.path(getwd(), "data", "discover.json")) {
  message("Starting discover data fetch...")

  # Fetch package stats
  packages <- fetch_package_stats(limit = 200)

  if (length(packages) == 0) {
    warning("No packages fetched, aborting")
    return(NULL)
  }

  # Build discover data
  discover <- list(
    updated = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    trending = get_trending(packages, n = 12),
    new = get_new(packages, n = 12),
    rising = get_rising(packages, n = 12)
  )

  # Export to JSON
  dir.create(dirname(output_path), showWarnings = FALSE, recursive = TRUE)

  json_output <- toJSON(discover, auto_unbox = TRUE, pretty = TRUE)
  writeLines(json_output, output_path)

  message(sprintf("\nExported discover data to %s", output_path))
  message(sprintf("  - %d trending packages", length(discover$trending)))
  message(sprintf("  - %d new packages", length(discover$new)))
  message(sprintf("  - %d rising packages", length(discover$rising)))

  invisible(discover)
}

# Run if called directly
if (sys.nframe() == 0) {
  run_discover_fetch()
}
