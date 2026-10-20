# fetch_discover.R
# Fetch hidden gem packages from R-universe for the Discover section

library(httr2)
library(jsonlite)
library(dplyr)

# R-universe global search API (the old /stats/descriptions endpoint was retired)
RUNIVERSE_SEARCH_URL <- "https://r-universe.dev/api/search"

# Null coalescing operator (handles NA and empty values)
`%||%` <- function(x, y) {
  if (is.null(x) || length(x) == 0) return(y)
  if (length(x) == 1 && is.na(x)) return(y)
  x
}

#' Fetch package stats from R-universe global search API
#' @param limit Number of packages to fetch (results are ranked by score, highest first)
#' @return A list of package data
fetch_package_stats <- function(limit = 1000) {
  message("Fetching package stats from R-universe...")

  url <- sprintf("%s?limit=%d", RUNIVERSE_SEARCH_URL, limit)

  tryCatch({
    resp <- request(url) |>
      req_headers(Accept = "application/json") |>
      req_timeout(60) |>
      req_perform()

    body <- fromJSON(resp_body_string(resp), simplifyVector = FALSE)
    data <- body$results

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
    stars = safe_int(pkg$stars, 0L),
    score = as.numeric(pkg$`_score` %||% 0),
    usedby = safe_int(pkg$`_usedby`, 0L),
    published = pkg$`Date/Publication` %||% pkg$`_published` %||% "",
    created = pkg$`_created` %||% "",
    maintainer = pkg$maintainer$name %||% "",
    url = sprintf("https://%s.r-universe.dev/%s", user, package_name),
    user = user
  )
}


#' Get hidden gem packages (high quality score relative to visibility)
#' @param packages List of package data
#' @param n Number to return
#' @return List of hidden gem packages
get_hidden_gems <- function(packages, n = 20) {
  message("  Computing hidden gems (score / log10(max(stars, usedby) + 10))...")

  # Extract info for all packages
  pkg_info <- Filter(Negate(is.null), lapply(packages, extract_package_info))

  # `packages` is already the top-scored slice of the full R-universe index
  # (fetch_package_stats pulls results ranked by score), so no extra quality
  # floor is needed here beyond excluding non-positive scores.
  pkg_info <- Filter(function(p) p$score > 0, pkg_info)

  if (length(pkg_info) == 0) {
    message("    Warning: no packages met score threshold")
    return(list())
  }

  # gem_score = quality / log10(visibility + 10), where visibility is the larger
  # of GitHub stars and reverse dependencies. Stars alone are 0 for packages
  # not hosted on GitHub (e.g. zoo, Matrix), which made them look obscure.
  # High ratio means high quality but low visibility — the ideal hidden gem
  gem_scores <- sapply(pkg_info, function(p) {
    p$score / log10(max(p$stars, p$usedby) + 10)
  })

  sorted_indices <- order(gem_scores, decreasing = TRUE)
  results <- pkg_info[sorted_indices]
  head(results, n)
}

#' Fetch a package's current version from its universe's package API
#' (/api/search doesn't return Version, so this is a small follow-up
#' request made only for the packages actually selected as hidden gems)
#' @param user Universe/owner name
#' @param name Package name
#' @return Version string, or "" on failure
fetch_package_version <- function(user, name) {
  url <- sprintf("https://%s.r-universe.dev/api/packages/%s", user, name)

  tryCatch({
    resp <- request(url) |>
      req_headers(Accept = "application/json") |>
      req_timeout(15) |>
      req_perform()

    pkg <- fromJSON(resp_body_string(resp), simplifyVector = FALSE)
    pkg$Version %||% ""

  }, error = function(e) "")
}

#' Fill in the version field for a list of hidden gem packages
#' @param gems List of hidden gem packages (from get_hidden_gems)
#' @return The same list with version fields populated where available
fill_versions <- function(gems) {
  message(sprintf("  Fetching versions for %d hidden gems...", length(gems)))
  lapply(gems, function(gem) {
    gem$version <- fetch_package_version(gem$user, gem$name)
    gem
  })
}

#' Main function to fetch and export discover data
#' @param output_path Path to save the JSON file
#' @return The discover data list
run_discover_fetch <- function(output_path = file.path(getwd(), "data", "discover.json")) {
  message("Starting discover data fetch...")

  # Fetch a large pool so hidden gems (high score, low downloads) are reachable
  packages <- fetch_package_stats()

  if (length(packages) == 0) {
    warning("No packages fetched, aborting")
    return(NULL)
  }

  # Build discover data
  discover <- list(
    updated = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    hidden_gems = fill_versions(get_hidden_gems(packages, n = 20))
  )

  # Export to JSON
  dir.create(dirname(output_path), showWarnings = FALSE, recursive = TRUE)

  json_output <- toJSON(discover, auto_unbox = TRUE, pretty = TRUE)
  writeLines(json_output, output_path)

  message(sprintf("\nExported discover data to %s", output_path))
  message(sprintf("  - %d hidden gems", length(discover$hidden_gems)))

  invisible(discover)
}

# Run if called directly
if (sys.nframe() == 0) {
  run_discover_fetch()
}
