# Convert Google Sheets export to reviews.json
# Usage: Rscript scripts/convert_reviews.R path/to/responses.csv

library(jsonlite)

convert_reviews <- function(csv_path, output_path = "data/reviews.json", append = TRUE) {

  # Read the CSV export from Google Sheets
  responses <- read.csv(csv_path, stringsAsFactors = FALSE)

  # Expected column names from Google Form (adjust if your form differs)
  # The first column is usually "Timestamp" from Google Forms
  col_map <- list(
    timestamp = 1,
    package_name = "Package.name",
    author = "User.name",
    rating = "Overall.package.rating",
    use_case = "What.task.did.you.use.this.package.for.",
    met_needs = "Did.the.package.have.the.functionality.you.needed.",
    learning_curve = "How.was.the.learning.curve.",
    would_use_again = "Would.you.use.this.package.again.",
    experience_level = "What.is.your.R.experience.level",
    documentation = "How.was.the.package.documentation.quality.",
    error_messages = "Were.the.error.messages.helpful.",
    hardest_part = "What.was.the.hardest.part.about.using.this.package.",
    missing_feature = "What.feature.is.missing.",
    bugs_encountered = "Did.you.encounter.bugs.",
    tips = "What.should.new.users.know.about.using.this.package.",
    best_thing = "What.is.the.best.feature.of.this.package.",
    would_improve = "What.would.you.improve.about.this.package."
  )

  # Function to safely get column value
  get_col <- function(row, col_name) {
    # Try exact match first
    if (col_name %in% names(row)) {
      return(as.character(row[[col_name]]))
    }
    # Try partial match (Google Sheets sometimes truncates)
    matches <- grep(gsub("\\.", ".", substr(col_name, 1, 30), fixed = TRUE),
                    names(row), value = TRUE, ignore.case = TRUE)
    if (length(matches) > 0) {
      return(as.character(row[[matches[1]]]))
    }
    return("")
  }

  # Convert each response to review format
  reviews <- lapply(seq_len(nrow(responses)), function(i) {
    row <- responses[i, ]

    # Parse timestamp from Google Forms format
    timestamp_str <- as.character(row[[1]])
    timestamp <- tryCatch({
      as.POSIXct(timestamp_str, format = "%m/%d/%Y %H:%M:%S")
    }, error = function(e) {
      Sys.time()
    })

    # Generate unique ID from timestamp
    id <- format(as.numeric(timestamp) * 1000, scientific = FALSE)

    list(
      id = id,
      package_name = get_col(row, col_map$package_name),
      author = get_col(row, col_map$author),
      experience_level = get_col(row, col_map$experience_level),
      created_at = format(timestamp, "%Y-%m-%dT%H:%M:%S.000Z"),
      rating = as.integer(get_col(row, col_map$rating)),
      use_case = get_col(row, col_map$use_case),
      met_needs = get_col(row, col_map$met_needs),
      learning_curve = get_col(row, col_map$learning_curve),
      would_use_again = get_col(row, col_map$would_use_again),
      documentation = get_col(row, col_map$documentation),
      error_messages = get_col(row, col_map$error_messages),
      bugs_encountered = get_col(row, col_map$bugs_encountered),
      hardest_part = get_col(row, col_map$hardest_part),
      missing_feature = get_col(row, col_map$missing_feature),
      best_thing = get_col(row, col_map$best_thing),
      would_improve = get_col(row, col_map$would_improve),
      tips = get_col(row, col_map$tips),
      helpful_count = 0,
      verified = FALSE
    )
  })

  # If appending, read existing reviews first
  if (append && file.exists(output_path)) {
    existing <- fromJSON(output_path)
    existing_reviews <- existing$reviews

    # Check for duplicates by id
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
    message(sprintf("Creating reviews.json with %d reviews", length(all_reviews)))
  }

  # Create output structure
  output <- list(
    reviews = all_reviews,
    updated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%S.000Z")
  )

  # Write JSON
  write_json(output, output_path, pretty = TRUE, auto_unbox = TRUE)
  message(sprintf("Written to %s", output_path))

  invisible(output)
}

# Run if called from command line
if (!interactive()) {
  args <- commandArgs(trailingOnly = TRUE)
  if (length(args) < 1) {
    cat("Usage: Rscript scripts/convert_reviews.R <csv_file> [output_file] [--replace]\n")
    cat("\nArguments:\n")
    cat("  csv_file    Path to Google Sheets CSV export\n")
    cat("  output_file Path to reviews.json (default: data/reviews.json)\n")
    cat("  --replace   Replace existing reviews instead of appending\n")
    quit(status = 1)
  }

  csv_file <- args[1]
  output_file <- if (length(args) >= 2 && !startsWith(args[2], "--")) args[2] else "data/reviews.json"
  append <- !("--replace" %in% args)

  convert_reviews(csv_file, output_file, append = append)
}
