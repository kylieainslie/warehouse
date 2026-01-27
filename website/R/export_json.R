# export_json.R
# Export package data to JSON for client-side search

library(DBI)
library(RSQLite)
library(jsonlite)
library(dplyr)

# Default paths (relative to working directory)
DB_PATH <- file.path(getwd(), "data", "warehouse.sqlite")
JSON_PATH <- file.path(getwd(), "data", "packages.json")

#' Export packages to JSON for client-side search index
#' @param db_path Path to the SQLite database file
#' @param json_path Path for the output JSON file
export_search_index <- function(db_path = DB_PATH, json_path = JSON_PATH) {
  con <- dbConnect(RSQLite::SQLite(), db_path)
  on.exit(dbDisconnect(con))

  message("Exporting packages to JSON...")

  # Get all packages
  packages <- dbGetQuery(con, "
    SELECT
      id,
      package_name,
      title,
      description,
      version,
      maintainer,
      author,
      url,
      bug_reports,
      repository,
      exports,
      topics,
      score,
      stars,
      primary_category,
      source_universe
    FROM packages
    ORDER BY score DESC
  ")

  # Parse JSON fields and create searchable text
  packages_list <- lapply(seq_len(nrow(packages)), function(i) {
    row <- packages[i, ]

    # Parse JSON strings back to arrays
    exports <- tryCatch(
      fromJSON(row$exports),
      error = function(e) character(0)
    )
    topics <- tryCatch(
      fromJSON(row$topics),
      error = function(e) character(0)
    )

    # Ensure they're character vectors
    if (!is.character(exports)) exports <- character(0)
    if (!is.character(topics)) topics <- character(0)

    # Create searchable text combining all relevant fields
    search_parts <- c(
      row$package_name,
      row$title,
      row$description,
      paste(exports, collapse = " "),
      paste(topics, collapse = " ")
    )
    search_text <- paste(search_parts[!is.na(search_parts)], collapse = " ")

    list(
      id = row$id,
      package_name = row$package_name,
      title = row$title %||% "",
      description = row$description %||% "",
      version = row$version %||% "",
      maintainer = row$maintainer %||% "",
      author = row$author %||% "",
      url = row$url %||% "",
      bug_reports = row$bug_reports %||% "",
      repository = row$repository %||% "",
      exports = exports,
      topics = topics,
      score = row$score,
      stars = row$stars %||% 0,
      primary_category = row$primary_category %||% "",
      source_universe = row$source_universe %||% "",
      search_text = search_text
    )
  })

  # Create the search index structure
  search_index <- list(
    packages = packages_list,
    metadata = list(
      generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
      total_packages = length(packages_list),
      version = "1.0"
    )
  )

  # Ensure output directory exists
  dir.create(dirname(json_path), showWarnings = FALSE, recursive = TRUE)

  # Write JSON
  write_json(search_index, json_path, pretty = TRUE, auto_unbox = TRUE)

  message(sprintf("Exported %d packages to %s", length(packages_list), json_path))
  message(sprintf("File size: %.1f KB", file.size(json_path) / 1024))

  invisible(json_path)
}

#' Export category-specific JSON files
#' @param db_path Path to the SQLite database file
#' @param output_dir Directory for category JSON files
export_category_json <- function(db_path = DB_PATH,
                                 output_dir = file.path(getwd(), "data", "categories")) {
  con <- dbConnect(RSQLite::SQLite(), db_path)
  on.exit(dbDisconnect(con))

  # Get unique categories
  categories <- dbGetQuery(con, "
    SELECT DISTINCT primary_category
    FROM packages
    WHERE primary_category IS NOT NULL
  ")

  dir.create(output_dir, showWarnings = FALSE, recursive = TRUE)

  for (cat in categories$primary_category) {
    packages <- dbGetQuery(con, "
      SELECT
        id, package_name, title, description, version,
        maintainer, url, exports, topics, score, stars
      FROM packages
      WHERE primary_category = ?
      ORDER BY score DESC
    ", params = list(cat))

    # Parse JSON fields
    packages_list <- lapply(seq_len(nrow(packages)), function(i) {
      row <- packages[i, ]

      exports <- tryCatch(fromJSON(row$exports), error = function(e) character(0))
      topics <- tryCatch(fromJSON(row$topics), error = function(e) character(0))

      list(
        id = row$id,
        package_name = row$package_name,
        title = row$title %||% "",
        description = row$description %||% "",
        version = row$version %||% "",
        maintainer = row$maintainer %||% "",
        url = row$url %||% "",
        exports = if (is.character(exports)) exports else character(0),
        topics = if (is.character(topics)) topics else character(0),
        score = row$score,
        stars = row$stars %||% 0
      )
    })

    json_path <- file.path(output_dir, sprintf("%s.json", cat))
    write_json(packages_list, json_path, pretty = TRUE, auto_unbox = TRUE)
    message(sprintf("Exported %d packages for category: %s", length(packages_list), cat))
  }

  invisible(output_dir)
}

#' Export a compact summary for the chatbot context
#' @param db_path Path to the SQLite database file
#' @param json_path Path for the output JSON file
export_chatbot_context <- function(db_path = DB_PATH,
                                   json_path = file.path(getwd(), "data", "chatbot_context.json")) {
  con <- dbConnect(RSQLite::SQLite(), db_path)
  on.exit(dbDisconnect(con))

  message("Exporting chatbot context...")

  # Get packages with key info for chatbot - limit to top packages by score
  packages <- dbGetQuery(con, "
    SELECT
      package_name,
      title,
      description,
      exports,
      topics,
      score,
      primary_category
    FROM packages
    WHERE score IS NOT NULL
    ORDER BY score DESC
    LIMIT 500
  ")

  # Create compact summaries
  summaries <- lapply(seq_len(nrow(packages)), function(i) {
    row <- packages[i, ]

    exports <- tryCatch(fromJSON(row$exports), error = function(e) character(0))
    topics <- tryCatch(fromJSON(row$topics), error = function(e) character(0))

    # Take only first 10 exports for context efficiency
    if (length(exports) > 10) exports <- exports[1:10]

    list(
      name = row$package_name,
      title = row$title %||% "",
      desc = substr(row$description %||% "", 1, 200),  # Truncate description
      funcs = if (is.character(exports)) exports else character(0),
      topics = if (is.character(topics)) topics else character(0),
      score = row$score,
      cat = row$primary_category %||% ""
    )
  })

  # Create context structure
  context <- list(
    packages = summaries,
    categories = dbGetQuery(con, "SELECT slug, name, description FROM categories"),
    generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
  )

  write_json(context, json_path, pretty = FALSE, auto_unbox = TRUE)

  message(sprintf("Exported chatbot context: %d packages, %.1f KB",
                  length(summaries), file.size(json_path) / 1024))

  invisible(json_path)
}

#' Null coalescing operator
`%||%` <- function(x, y) if (is.null(x) || length(x) == 0 || is.na(x)) y else x

#' Export a lightweight search index for client-side use
#' This version is optimized for size - only includes fields needed for search/display
#' @param db_path Path to the SQLite database file
#' @param json_path Path for the output JSON file
export_lightweight_index <- function(db_path = DB_PATH,
                                     json_path = file.path(getwd(), "data", "packages-search.json")) {
  con <- dbConnect(RSQLite::SQLite(), db_path)
  on.exit(dbDisconnect(con))

  message("Exporting lightweight search index...")

  # Get packages with only essential fields

  packages <- dbGetQuery(con, "
    SELECT
      id,
      package_name,
      title,
      description,
      version,
      url,
      bug_reports,
      repository,
      exports,
      topics,
      score,
      stars,
      primary_category,
      source_universe
    FROM packages
    ORDER BY score DESC
  ")

  # Create compact package objects
  packages_list <- lapply(seq_len(nrow(packages)), function(i) {
    row <- packages[i, ]

    # Parse JSON and limit array sizes
    exports <- tryCatch(fromJSON(row$exports), error = function(e) character(0))
    topics <- tryCatch(fromJSON(row$topics), error = function(e) character(0))

    # Ensure they're character vectors
    if (!is.character(exports)) exports <- character(0)
    if (!is.character(topics)) topics <- character(0)

    # Limit exports to first 15 (enough for search, saves space)
    if (length(exports) > 15) exports <- exports[1:15]

    # Limit topics to first 8
    if (length(topics) > 8) topics <- topics[1:8]

    # Truncate description to 300 chars
    desc <- row$description %||% ""
    if (nchar(desc) > 300) desc <- paste0(substr(desc, 1, 297), "...")

    list(
      id = row$id,
      package_name = row$package_name,
      title = row$title %||% "",
      description = desc,
      version = row$version %||% "",
      url = row$url %||% "",
      bug_reports = row$bug_reports %||% "",
      repository = row$repository %||% "",
      exports = exports,
      topics = topics,
      score = row$score,
      stars = row$stars %||% 0,
      primary_category = row$primary_category %||% "",
      source_universe = row$source_universe %||% ""
    )
  })

  # Create the search index structure
  search_index <- list(
    packages = packages_list,
    metadata = list(
      generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ"),
      total_packages = length(packages_list),
      version = "2.0",
      type = "lightweight"
    )
  )

  # Write JSON (not pretty - saves ~30% space)
  write_json(search_index, json_path, pretty = FALSE, auto_unbox = TRUE)

  file_size_mb <- file.size(json_path) / (1024 * 1024)
  message(sprintf("Exported %d packages to %s", length(packages_list), json_path))
  message(sprintf("File size: %.2f MB", file_size_mb))

  invisible(json_path)
}

#' Main function to export all JSON files
#' @param db_path Path to the SQLite database file
export_all <- function(db_path = DB_PATH) {
  export_search_index(db_path)        # Full index (for detail pages)
  export_lightweight_index(db_path)   # Lightweight index (for client-side search)
  export_category_json(db_path)
  export_chatbot_context(db_path)

  message("\nAll exports complete!")
}

# Run if called directly
if (sys.nframe() == 0) {
  export_all()
}
