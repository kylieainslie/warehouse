# import_submitted.R
# Import manually submitted packages into the database

library(jsonlite)
library(DBI)
library(RSQLite)
library(dplyr)

DB_PATH <- file.path(getwd(), "data", "warehouse.sqlite")
SUBMITTED_PATH <- file.path(getwd(), "data", "submitted-packages.json")

#' Import submitted packages into the database
#' @param submitted_path Path to submitted-packages.json
#' @param db_path Path to the SQLite database
import_submitted_packages <- function(
    submitted_path = SUBMITTED_PATH,
    db_path = DB_PATH
) {
  if (!file.exists(submitted_path)) {
    message("No submitted packages file found")
    return(invisible(0))
  }

  submitted <- fromJSON(submitted_path)

  if (length(submitted$packages) == 0) {
    message("No submitted packages to import")
    return(invisible(0))
  }

  message(sprintf("Importing %d submitted packages...", length(submitted$packages)))

  con <- dbConnect(RSQLite::SQLite(), db_path)
  on.exit(dbDisconnect(con))

  inserted <- 0
  updated <- 0

  for (pkg in submitted$packages) {
    # Check if package exists
    existing <- dbGetQuery(con, "SELECT id FROM packages WHERE package_name = ?",
                           params = list(pkg$package_name))

    # Build description from multiple fields
    full_description <- paste(
      pkg$description %||% "",
      if (!is.null(pkg$use_cases) && pkg$use_cases != "") paste("\n\nUse cases:", pkg$use_cases) else "",
      if (!is.null(pkg$unique_features) && pkg$unique_features != "") paste("\n\nUnique features:", pkg$unique_features) else "",
      sep = ""
    )

    # Convert keywords to JSON
    keywords_json <- if (!is.null(pkg$keywords) && length(pkg$keywords) > 0) {
      toJSON(pkg$keywords, auto_unbox = FALSE)
    } else {
      "[]"
    }

    if (nrow(existing) == 0) {
      # Insert new package
      dbExecute(con, "
        INSERT INTO packages (
          package_name, title, description, version, maintainer, author,
          license, url, bug_reports, repository, exports, topics, dependencies,
          score, stars, registered, source_universe, primary_category, scraped_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ", list(
        pkg$package_name,
        pkg$title %||% "",
        full_description,
        "",  # version - not in submission form
        pkg$submitter_name %||% "",
        "",  # author
        "",  # license
        pkg$url %||% "",
        "",  # bug_reports
        pkg$url %||% "",  # repository
        "[]",  # exports
        keywords_json,  # topics/keywords
        "[]",  # dependencies
        pkg$score,
        pkg$stars %||% 0L,
        "",  # registered
        "submitted",
        pkg$primary_category %||% "general",
        pkg$submitted_at %||% as.character(Sys.time())
      ))
      inserted <- inserted + 1
      message(sprintf("  Inserted: %s", pkg$package_name))
    } else {
      # Update existing package (only if source is 'submitted')
      dbExecute(con, "
        UPDATE packages SET
          title = COALESCE(NULLIF(?, ''), title),
          description = COALESCE(NULLIF(?, ''), description),
          url = COALESCE(NULLIF(?, ''), url),
          topics = COALESCE(NULLIF(?, '[]'), topics),
          primary_category = COALESCE(NULLIF(?, ''), primary_category),
          updated_at = CURRENT_TIMESTAMP
        WHERE package_name = ? AND source_universe = 'submitted'
      ", list(
        pkg$title %||% "",
        full_description,
        pkg$url %||% "",
        keywords_json,
        pkg$primary_category %||% "",
        pkg$package_name
      ))
      updated <- updated + 1
      message(sprintf("  Updated: %s", pkg$package_name))
    }
  }

  message(sprintf("Import complete: %d inserted, %d updated", inserted, updated))
  invisible(inserted + updated)
}

# Null coalescing operator
`%||%` <- function(x, y) {
  if (is.null(x) || length(x) == 0 || (length(x) == 1 && is.na(x))) y else x
}

# Run if called directly
if (sys.nframe() == 0) {
  import_submitted_packages()
}
