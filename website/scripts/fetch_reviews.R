# Fetch reviews from Google Sheets and update reviews.json
# Requires: googlesheets4, jsonlite

library(googlesheets4)
library(jsonlite)

fetch_and_update_reviews <- function(
    sheet_id,
    output_path = "data/reviews.json",
    append = TRUE
) {

  # Read from Google Sheets
  message("Fetching reviews from Google Sheets...")
  responses <- read_sheet(sheet_id)

  if (nrow(responses) == 0) {
    message("No responses found in sheet.")
    return(invisible(NULL))
  }

  message(sprintf("Found %d responses", nrow(responses)))

  # Normalize column names (Google Forms adds weird characters)
  clean_names <- function(x) {
    x <- tolower(x)
    x <- gsub("[^a-z0-9]+", "_", x)
    x <- gsub("^_|_$", "", x)
    x
  }
  names(responses) <- clean_names(names(responses))

  # Helper to find column by partial match
  find_col <- function(df, pattern) {
    matches <- grep(pattern, names(df), value = TRUE, ignore.case = TRUE)
    if (length(matches) > 0) matches[1] else NA
  }

  # Map columns
  col_timestamp <- find_col(responses, "timestamp")
  col_package <- find_col(responses, "package")
  col_author <- find_col(responses, "user_name|author|name")
  col_rating <- find_col(responses, "rating")
  col_use_case <- find_col(responses, "task|use")
  col_met_needs <- find_col(responses, "functionality|needs")
  col_learning <- find_col(responses, "learning")
  col_again <- find_col(responses, "again")
  col_experience <- find_col(responses, "experience")
  col_docs <- find_col(responses, "documentation")
  col_errors <- find_col(responses, "error")
  col_hardest <- find_col(responses, "hardest")
  col_missing <- find_col(responses, "missing")
  col_bugs <- find_col(responses, "bugs")
  col_tips <- find_col(responses, "new_users|tips|know")
  col_best <- find_col(responses, "best")
  col_improve <- find_col(responses, "improve")

  # Safe column getter
  get_val <- function(row, col) {
    if (is.na(col) || !(col %in% names(row))) return("")
    val <- row[[col]]
    if (is.null(val) || is.na(val)) return("")
    as.character(val)
  }

  get_int <- function(row, col) {
    val <- get_val(row, col)
    if (val == "") return(NA_integer_)
    as.integer(val)
  }

  # Convert each response
  reviews <- lapply(seq_len(nrow(responses)), function(i) {
    row <- responses[i, ]

    # Parse timestamp
    ts <- row[[col_timestamp]]
    if (inherits(ts, "POSIXct")) {
      timestamp <- ts
    } else {
      timestamp <- tryCatch(
        as.POSIXct(as.character(ts), format = "%m/%d/%Y %H:%M:%S"),
        error = function(e) Sys.time()
      )
    }

    # Generate ID from timestamp
    id <- format(as.numeric(timestamp) * 1000, scientific = FALSE)

    list(
      id = id,
      package_name = get_val(row, col_package),
      author = get_val(row, col_author),
      experience_level = get_val(row, col_experience),
      created_at = format(timestamp, "%Y-%m-%dT%H:%M:%S.000Z"),
      rating = get_int(row, col_rating),
      use_case = get_val(row, col_use_case),
      met_needs = get_val(row, col_met_needs),
      learning_curve = get_val(row, col_learning),
      would_use_again = get_val(row, col_again),
      documentation = get_val(row, col_docs),
      error_messages = get_val(row, col_errors),
      bugs_encountered = get_val(row, col_bugs),
      hardest_part = get_val(row, col_hardest),
      missing_feature = get_val(row, col_missing),
      best_thing = get_val(row, col_best),
      would_improve = get_val(row, col_improve),
      tips = get_val(row, col_tips),
      helpful_count = 0L,
      verified = FALSE
    )
  })

  # Filter out reviews with no package name
  reviews <- Filter(function(r) nchar(r$package_name) > 0, reviews)

  if (length(reviews) == 0) {
    message("No valid reviews found.")
    return(invisible(NULL))
  }

  # Handle append/replace
  if (append && file.exists(output_path)) {
    existing <- fromJSON(output_path)
    existing_reviews <- existing$reviews

    existing_ids <- sapply(existing_reviews, function(r) r$id)
    new_reviews <- Filter(function(r) !(r$id %in% existing_ids), reviews)

    if (length(new_reviews) == 0) {
      message("No new reviews to add.")
      return(invisible(NULL))
    }

    all_reviews <- c(existing_reviews, new_reviews)
    message(sprintf("Adding %d new reviews (total: %d)",
                    length(new_reviews), length(all_reviews)))
  } else {
    all_reviews <- reviews
    message(sprintf("Writing %d reviews", length(all_reviews)))
  }

  # Write output
  output <- list(
    reviews = all_reviews,
    updated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%S.000Z")
  )

  write_json(output, output_path, pretty = TRUE, auto_unbox = TRUE)
  message(sprintf("Updated %s", output_path))

  invisible(output)
}

# Command line interface
if (!interactive()) {
  args <- commandArgs(trailingOnly = TRUE)

  if (length(args) < 1) {
    cat("Usage: Rscript scripts/fetch_reviews.R <sheet_id> [--replace]\n")
    quit(status = 1)
  }

  sheet_id <- args[1]
  append <- !("--replace" %in% args)

  # Authenticate with service account if GOOGLE_APPLICATION_CREDENTIALS is set
  if (Sys.getenv("GOOGLE_APPLICATION_CREDENTIALS") != "") {
    gs4_auth(path = Sys.getenv("GOOGLE_APPLICATION_CREDENTIALS"))
  } else {
    # For local use, will prompt for OAuth
    gs4_auth()
  }

  fetch_and_update_reviews(sheet_id, append = append)
}
