# scrape_rweekly.R
# Scrape package mentions from R Weekly posts

library(httr2)
library(jsonlite)
library(dplyr)
library(stringr)
library(purrr)

# Configuration
RWEEKLY_REPO <- "rweekly/rweekly.org"
RWEEKLY_BRANCH <- "gh-pages"
POSTS_PATH <- "_posts"
OUTPUT_FILE <- "data/rweekly-packages.json"

# Number of recent weeks to fetch
NUM_WEEKS <- 12

#' Get list of recent R Weekly post files from GitHub
get_post_files <- function(num_posts = NUM_WEEKS) {
  message("Fetching R Weekly post list from GitHub...")

  url <- sprintf(
    "https://api.github.com/repos/%s/contents/%s?ref=%s",
    RWEEKLY_REPO, POSTS_PATH, RWEEKLY_BRANCH
  )

  resp <- request(url) |>
    req_headers(
      Accept = "application/vnd.github.v3+json",
      `User-Agent` = "TheWarehouse-RWeekly-Scraper"
    ) |>
    req_perform()

  files <- resp_body_json(resp)

  # Filter to markdown files and sort by name (date) descending
  md_files <- files |>
    keep(~ grepl("\\.md$", .x$name)) |>
    map_chr(~ .x$name) |>
    sort(decreasing = TRUE)

  # Return most recent posts
  head(md_files, num_posts)
}

#' Fetch and parse a single R Weekly post
fetch_post <- function(filename) {
  message(sprintf("  Fetching %s...", filename))

  url <- sprintf(
    "https://raw.githubusercontent.com/%s/%s/%s/%s",
    RWEEKLY_REPO, RWEEKLY_BRANCH, POSTS_PATH, filename
  )

  resp <- request(url) |>
    req_headers(`User-Agent` = "TheWarehouse-RWeekly-Scraper") |>
    req_perform()

  content <- resp_body_string(resp)

  # Extract date from filename (format: YYYY-MM-DD-*.md)
  date_match <- str_match(filename, "^(\\d{4}-\\d{2}-\\d{2})")
  post_date <- if (!is.na(date_match[1, 2])) date_match[1, 2] else NA

  # Extract week identifier if present (format: 2025-W52)
  week_match <- str_match(filename, "(\\d{4}-W\\d+)")
  week_id <- if (!is.na(week_match[1, 2])) week_match[1, 2] else NA

  list(
    filename = filename,
    date = post_date,
    week = week_id,
    content = content
  )
}

#' Extract packages from a post's content
#' Looks for patterns like: + [{packagename} version](url) - description
extract_packages <- function(post) {
  content <- post$content

  # Find New Packages section
  new_pkg_section <- extract_section(content, "New Packages")


  # Find Updated Packages section
  updated_pkg_section <- extract_section(content, "Updated Packages")

  # Parse packages from each section
  new_packages <- parse_package_entries(new_pkg_section, "new")
  updated_packages <- parse_package_entries(updated_pkg_section, "updated")

  # Combine and add post metadata
  all_packages <- bind_rows(new_packages, updated_packages)

  if (nrow(all_packages) > 0) {
    all_packages <- all_packages |>
      mutate(
        post_date = post$date,
        week = post$week,
        source = "rweekly"
      )
  }

  all_packages
}

#' Extract a section from markdown content
extract_section <- function(content, section_name) {
  # Pattern to match section header and capture content until next ## header
  pattern <- sprintf(
    "###?\\s*%s.*?\\n(.*?)(?=\\n##|$)",
    section_name
  )

  match <- str_match(content, regex(pattern, dotall = TRUE, ignore_case = TRUE))

  if (!is.na(match[1, 2])) {
    return(match[1, 2])
  }

  ""
}

#' Parse package entries from section content
#' Format: + [{packagename} version](url) - description
#' Or: + [{packagename} version](url): description
parse_package_entries <- function(section_content, type) {
  if (is.null(section_content) || nchar(section_content) == 0) {
    return(tibble(
      package_name = character(),
      version = character(),
      url = character(),
      description = character(),
      type = character()
    ))
  }

  # Pattern to match package entries
  # Matches: + [{name} version](url) - description
  # Or: + [{name} version](url): description
  pattern <- "\\+\\s*\\[\\{([^}]+)\\}\\s*([^\\]]+)?\\]\\(([^)]+)\\)\\s*[-:]?\\s*(.*)?"

  matches <- str_match_all(section_content, pattern)[[1]]

  if (nrow(matches) == 0) {
    return(tibble(
      package_name = character(),
      version = character(),
      url = character(),
      description = character(),
      type = character()
    ))
  }

  tibble(
    package_name = str_trim(matches[, 2]),
    version = str_trim(matches[, 3]),
    url = str_trim(matches[, 4]),
    description = str_trim(matches[, 5]),
    type = type
  ) |>
    filter(!is.na(package_name), nchar(package_name) > 0)
}

#' Main function to scrape R Weekly packages
scrape_rweekly <- function(num_weeks = NUM_WEEKS, output_file = OUTPUT_FILE) {
  message("=== R Weekly Package Scraper ===")
  message(sprintf("Fetching last %d weeks of R Weekly...", num_weeks))

  # Get recent post files
  post_files <- get_post_files(num_weeks)
  message(sprintf("Found %d posts to process", length(post_files)))

  # Fetch and parse each post
  all_packages <- map_dfr(post_files, function(filename) {
    tryCatch({
      post <- fetch_post(filename)
      extract_packages(post)
    }, error = function(e) {
      warning(sprintf("Error processing %s: %s", filename, e$message))
      tibble()
    })
  })

  message(sprintf("\nExtracted %d package mentions", nrow(all_packages)))

  # Deduplicate - keep most recent mention of each package
  packages_deduped <- all_packages |>
    arrange(desc(post_date)) |>
    group_by(package_name) |>
    slice(1) |>
    ungroup() |>
    arrange(desc(post_date), package_name)

  message(sprintf("After deduplication: %d unique packages", nrow(packages_deduped)))

  # Create output structure
  output <- list(
    metadata = list(
      scraped_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
      weeks_included = num_weeks,
      total_packages = nrow(packages_deduped),
      new_packages = sum(packages_deduped$type == "new"),
      updated_packages = sum(packages_deduped$type == "updated")
    ),
    packages = packages_deduped |>
      select(package_name, version, type, description, url, post_date, week) |>
      as.list() |>
      purrr::transpose()
  )

  # Ensure output directory exists
  dir.create(dirname(output_file), showWarnings = FALSE, recursive = TRUE)

  # Write JSON
  write_json(output, output_file, pretty = TRUE, auto_unbox = TRUE)
  message(sprintf("\nSaved to %s", output_file))

  invisible(output)
}

# Run if called directly
if (sys.nframe() == 0) {
  scrape_rweekly()
}
