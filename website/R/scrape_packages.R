# scrape_packages.R
# Scrape package metadata from R-universe API

library(httr2)
library(jsonlite)
library(dplyr)
library(purrr)

# Configuration
RUNIVERSE_API_BASE <- "https://r-universe.dev/api"

# Define source universes to scrape by category
SOURCE_UNIVERSES <- list(

  epidemiology = c("epiverse-trace", "mrc-ide", "reconverse"),
  tidyverse = c("tidyverse", "r-lib"),
  ropensci = c("ropensci"),
  bioconductor = c("bioc")
)

# Null coalescing operator
`%||%` <- function(x, y) if (is.null(x) || length(x) == 0) y else x

#' Fetch packages from a specific R-universe
#' @param universe Character. The universe name (e.g., "epiverse-trace")
#' @return A tibble of package metadata
fetch_universe_packages <- function(universe) {
  url <- sprintf("https://%s.r-universe.dev/api/packages", universe)

  message(sprintf("  Fetching from %s...", url))

  tryCatch({
    resp <- request(url) |>
      req_headers(Accept = "application/json") |>
      req_timeout(30) |>
      req_perform()

    packages <- resp |>
      resp_body_json(simplifyVector = FALSE)

    if (length(packages) == 0) {
      message(sprintf("  No packages found in %s", universe))
      return(tibble())
    }

    # Transform to tibble with key fields
    result <- map_dfr(packages, function(pkg) {
      tibble(
        package_name = pkg$Package %||% NA_character_,
        title = pkg$Title %||% NA_character_,
        description = pkg$Description %||% NA_character_,
        version = pkg$Version %||% NA_character_,
        maintainer = pkg$Maintainer %||% NA_character_,
        author = pkg$Author %||% NA_character_,
        license = pkg$License %||% NA_character_,
        url = pkg$URL %||% NA_character_,
        bug_reports = pkg$BugReports %||% NA_character_,
        repository = pkg$`_repo` %||% NA_character_,
        exports = list(pkg$`_exports` %||% character(0)),
        topics = list(pkg$`_topics` %||% character(0)),
        dependencies = list(pkg$`_dependencies` %||% list()),
        score = pkg$`_score` %||% NA_real_,
        stars = pkg$`_stars` %||% 0L,
        registered = pkg$`_registered` %||% NA_character_,
        source_universe = universe
      )
    })

    message(sprintf("  Found %d packages in %s", nrow(result), universe))
    result

  }, error = function(e) {
    warning(sprintf("Failed to fetch from %s: %s", universe, e$message))
    tibble()
  })
}

#' Search R-universe by topic/keyword
#' @param query Character. The search query
#' @param limit Integer. Maximum results to return
#' @return A tibble of search results
search_packages <- function(query, limit = 100) {
  url <- sprintf("%s/search", RUNIVERSE_API_BASE)

  message(sprintf("Searching for: %s", query))

  tryCatch({
    resp <- request(url) |>
      req_url_query(q = query, limit = limit) |>
      req_headers(Accept = "application/json") |>
      req_timeout(30) |>
      req_perform()

    results <- resp |>
      resp_body_json(simplifyVector = FALSE)

    if (length(results$results) == 0) {
      return(tibble())
    }

    map_dfr(results$results, function(pkg) {
      tibble(
        package_name = pkg$Package %||% NA_character_,
        title = pkg$Title %||% NA_character_,
        description = pkg$Description %||% NA_character_,
        version = pkg$Version %||% NA_character_,
        maintainer_name = pkg$maintainer$name %||% NA_character_,
        maintainer_email = pkg$maintainer$email %||% NA_character_,
        source_user = pkg$`_user` %||% NA_character_,
        stars = pkg$stars %||% 0L,
        score = pkg$`_score` %||% NA_real_,
        topics = list(pkg$`_topics` %||% character(0)),
        exports = list(pkg$`_exports` %||% character(0)),
        match_score = pkg$`_matchscore` %||% NA_real_
      )
    })

  }, error = function(e) {
    warning(sprintf("Search failed for '%s': %s", query, e$message))
    tibble()
  })
}

#' Scrape packages from all configured universes
#' @return A tibble with all scraped packages
scrape_all_universes <- function() {
  message("Starting package scraping from R-universe...")

  all_packages <- tibble()

  for (category in names(SOURCE_UNIVERSES)) {
    message(sprintf("\nCategory: %s", category))

    for (universe in SOURCE_UNIVERSES[[category]]) {
      pkgs <- fetch_universe_packages(universe)

      if (nrow(pkgs) > 0) {
        pkgs$primary_category <- category
        all_packages <- bind_rows(all_packages, pkgs)
      }

      Sys.sleep(1)  # Rate limiting - be nice to the API
    }
  }

  # Deduplicate by package name, keeping highest score
  all_packages <- all_packages |>
    filter(!is.na(package_name)) |>
    group_by(package_name) |>
    slice_max(order_by = coalesce(score, 0), n = 1, with_ties = FALSE) |>
    ungroup()

  message(sprintf("\nTotal: %d unique packages scraped", nrow(all_packages)))
  all_packages
}

#' Search for packages by topic keywords
#' @param topics Character vector of topics to search
#' @return A tibble of packages matching topics
scrape_by_topics <- function(topics) {
  message("Searching by topics...")

  all_results <- tibble()

  for (topic in topics) {
    results <- search_packages(sprintf("topic:%s", topic), limit = 50)

    if (nrow(results) > 0) {
      results$search_topic <- topic
      all_results <- bind_rows(all_results, results)
    }

    Sys.sleep(1)
  }

  # Deduplicate
  all_results |>
    filter(!is.na(package_name)) |>
    group_by(package_name) |>
    slice_max(order_by = coalesce(score, 0), n = 1, with_ties = FALSE) |>
    ungroup()
}

#' Main function to run the full scrape
#' @param output_path Path to save the scraped data (RDS file)
#' @return The scraped packages tibble
run_scrape <- function(output_path = file.path(getwd(), "data", "scraped_packages.rds")) {
  # Scrape from configured universes
  packages <- scrape_all_universes()

  # Add timestamp

packages$scraped_at <- Sys.time()

  # Save to file
  dir.create(dirname(output_path), showWarnings = FALSE, recursive = TRUE)
  saveRDS(packages, output_path)
  message(sprintf("Saved %d packages to %s", nrow(packages), output_path))

  invisible(packages)
}

# Run if called directly
if (sys.nframe() == 0) {
  run_scrape()
}
