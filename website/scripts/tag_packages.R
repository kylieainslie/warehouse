# tag_packages.R
# Auto-tag R packages using Claude Haiku via the Anthropic Messages Batch API.
# Reads packages from the SQLite database, tags only those not yet in auto-tags.json,
# and merges results back into auto-tags.json for use at export time.
#
# Usage:
#   Rscript scripts/tag_packages.R
#
# Requires env var: ANTHROPIC_API_KEY

library(httr2)
library(jsonlite)
library(DBI)
library(RSQLite)

# ── Config ────────────────────────────────────────────────────────────────────

MODEL         <- "claude-haiku-4-5-20251001"
MAX_TOKENS    <- 60       # enough for a JSON array of up to 5 short tags
BATCH_SIZE    <- 10000    # Anthropic Batch API limit per submission
POLL_INTERVAL <- 30       # seconds between status checks
MAX_WAIT_MIN  <- 120      # give up after 2 hours

DB_PATH        <- file.path(getwd(), "data", "warehouse.sqlite")
AUTO_TAGS_PATH <- file.path(getwd(), "data", "auto-tags.json")

API_URL_BATCH  <- "https://api.anthropic.com/v1/messages/batches"

# ── Tag taxonomy ──────────────────────────────────────────────────────────────
# Fixed vocabulary: Claude must choose only from these tags.
# Keep additions/removals here; the prompt is rebuilt from this vector.

TAXONOMY <- c(
  # Statistical methods
  "regression", "classification", "clustering", "dimensionality-reduction",
  "bayesian-inference", "survival-analysis", "time-series", "mixed-effects-models",
  "hypothesis-testing", "causal-inference", "meta-analysis", "missing-data",
  "simulation", "bootstrapping", "factor-analysis", "structural-equation-modeling",
  "network-analysis", "multivariate-analysis", "power-analysis", "propensity-score",

  # Application domains
  "epidemiology", "genomics", "bioinformatics", "pharmacometrics",
  "clinical-trials", "ecology", "finance", "social-science",
  "spatial-analysis", "neuroimaging", "proteomics", "metabolomics",
  "environmental-science", "agriculture", "economics", "psychometrics",
  "drug-development", "population-health",

  # Data engineering
  "data-wrangling", "data-import", "data-export", "web-scraping",
  "databases", "api-client", "text-processing", "natural-language-processing",
  "image-processing", "data-validation", "data-generation",

  # Visualisation & reporting
  "data-visualization", "interactive-visualization", "mapping",
  "tables", "dashboards", "reporting",

  # Machine learning
  "machine-learning", "deep-learning", "model-evaluation",
  "feature-engineering", "model-interpretation", "anomaly-detection",

  # Infrastructure
  "package-development", "unit-testing", "parallel-computing",
  "workflow-management", "shiny", "reproducibility", "literate-programming"
)

# ── Helpers ───────────────────────────────────────────────────────────────────

`%||%` <- function(x, y) if (is.null(x) || length(x) == 0 || (length(x) == 1 && is.na(x))) y else x

build_system_prompt <- function() {
  tags_str <- paste(TAXONOMY, collapse = ", ")
  paste0(
    "You are an R package classifier. ",
    "Given a package name, title, and description, assign 1-5 relevant tags from this fixed list:\n\n",
    tags_str, "\n\n",
    "Return ONLY a JSON array of tag strings, e.g. [\"regression\",\"bayesian-inference\"]. ",
    "If no tags fit well, return []. Never invent tags outside the list."
  )
}

build_user_message <- function(pkg) {
  paste0(
    "Package: ", pkg$package_name, "\n",
    "Title: ",   pkg$title %||% "", "\n",
    "Description: ", substr(pkg$description %||% "", 1, 400)
  )
}

api_headers <- function(key) {
  list(
    `x-api-key`         = key,
    `anthropic-version` = "2023-06-01",
    `anthropic-beta`    = "message-batches-2024-09-24",
    `content-type`      = "application/json"
  )
}

# ── Batch API calls ───────────────────────────────────────────────────────────

submit_batch <- function(requests, api_key) {
  message(sprintf("  Submitting batch of %d requests...", length(requests)))

  resp <- request(API_URL_BATCH) |>
    req_headers(!!!api_headers(api_key)) |>
    req_body_json(list(requests = requests)) |>
    req_timeout(60) |>
    req_perform()

  body <- resp_body_json(resp)
  message(sprintf("  Batch submitted: %s", body$id))
  body$id
}

poll_batch <- function(batch_id, api_key) {
  url <- sprintf("%s/%s", API_URL_BATCH, batch_id)
  deadline <- Sys.time() + MAX_WAIT_MIN * 60
  dot_count <- 0

  repeat {
    resp <- request(url) |>
      req_headers(!!!api_headers(api_key)) |>
      req_timeout(30) |>
      req_perform()

    body <- resp_body_json(resp)
    status <- body$processing_status

    if (status == "ended") {
      message("")
      message(sprintf(
        "  Batch ended — succeeded: %d, errored: %d, cancelled: %d",
        body$request_counts$succeeded %||% 0,
        body$request_counts$errored   %||% 0,
        body$request_counts$canceled  %||% 0
      ))
      return(invisible(NULL))
    }

    if (Sys.time() > deadline) {
      stop(sprintf(
        "Batch %s still running after %d minutes. ",
        batch_id, MAX_WAIT_MIN,
        "Re-run the script to resume — existing auto-tags.json is unchanged."
      ))
    }

    cat(".")
    dot_count <- dot_count + 1
    if (dot_count %% 60 == 0) cat("\n")
    Sys.sleep(POLL_INTERVAL)
  }
}

download_results <- function(batch_id, api_key) {
  url <- sprintf("%s/%s/results", API_URL_BATCH, batch_id)
  message(sprintf("  Downloading results for batch %s...", batch_id))

  resp <- request(url) |>
    req_headers(!!!api_headers(api_key)) |>
    req_timeout(120) |>
    req_perform()

  # Results are NDJSON — one JSON object per line
  lines <- strsplit(resp_body_string(resp), "\n")[[1]]
  lines <- lines[nchar(trimws(lines)) > 0]
  lapply(lines, fromJSON)
}

# ── Parse & store tags ────────────────────────────────────────────────────────

parse_tags_from_result <- function(result) {
  tryCatch({
    if (result$result$type != "succeeded") return(character(0))
    text <- result$result$message$content[[1]]$text
    tags <- fromJSON(text)
    if (!is.character(tags)) return(character(0))
    # Validate: keep only tags in the taxonomy
    tags[tags %in% TAXONOMY]
  }, error = function(e) character(0))
}

load_auto_tags <- function(path) {
  if (!file.exists(path)) return(list())
  tryCatch(as.list(fromJSON(path)), error = function(e) list())
}

save_auto_tags <- function(tags, path) {
  dir.create(dirname(path), showWarnings = FALSE, recursive = TRUE)
  writeLines(toJSON(tags, auto_unbox = FALSE, pretty = FALSE), path)
  message(sprintf("  Saved auto-tags for %d packages to %s", length(tags), path))
}

# ── Main ──────────────────────────────────────────────────────────────────────

run_tagging <- function(db_path    = DB_PATH,
                        tags_path  = AUTO_TAGS_PATH,
                        api_key    = Sys.getenv("ANTHROPIC_API_KEY")) {
  if (nchar(api_key) == 0) stop("ANTHROPIC_API_KEY environment variable is not set.")

  message("Loading packages from database...")
  con <- dbConnect(RSQLite::SQLite(), db_path)
  packages <- dbGetQuery(con, "
    SELECT package_name, title, description
    FROM packages
    ORDER BY score DESC
  ")
  dbDisconnect(con)
  message(sprintf("  Loaded %d packages", nrow(packages)))

  message("Loading existing auto-tags...")
  existing_tags <- load_auto_tags(tags_path)
  already_tagged <- names(existing_tags)
  message(sprintf("  Already tagged: %d packages", length(already_tagged)))

  # Only process packages not yet in auto-tags.json
  untagged <- packages[!packages$package_name %in% already_tagged, ]
  message(sprintf("  Packages needing tags: %d", nrow(untagged)))

  if (nrow(untagged) == 0) {
    message("Nothing to do — all packages are tagged.")
    return(invisible(NULL))
  }

  system_prompt <- build_system_prompt()

  # Split into batches of BATCH_SIZE and process sequentially
  n_batches <- ceiling(nrow(untagged) / BATCH_SIZE)
  message(sprintf("Processing %d batch(es) of up to %d requests each...", n_batches, BATCH_SIZE))

  for (batch_num in seq_len(n_batches)) {
    start_idx <- (batch_num - 1) * BATCH_SIZE + 1
    end_idx   <- min(batch_num * BATCH_SIZE, nrow(untagged))
    batch_pkgs <- untagged[start_idx:end_idx, ]

    message(sprintf("\nBatch %d/%d: packages %d-%d", batch_num, n_batches, start_idx, end_idx))

    # Build request objects
    requests <- lapply(seq_len(nrow(batch_pkgs)), function(i) {
      pkg <- batch_pkgs[i, ]
      list(
        custom_id = pkg$package_name,
        params = list(
          model      = MODEL,
          max_tokens = MAX_TOKENS,
          system     = system_prompt,
          messages   = list(
            list(role = "user", content = build_user_message(pkg))
          )
        )
      )
    })

    batch_id <- submit_batch(requests, api_key)
    message(sprintf("  Polling (up to %d min)...", MAX_WAIT_MIN), appendLF = FALSE)
    poll_batch(batch_id, api_key)

    results <- download_results(batch_id, api_key)

    # Parse results and merge into existing_tags
    new_count <- 0
    for (result in results) {
      pkg_name <- result$custom_id
      tags     <- parse_tags_from_result(result)
      existing_tags[[pkg_name]] <- tags
      new_count <- new_count + 1
    }
    message(sprintf("  Parsed tags for %d packages in this batch", new_count))

    # Save after each batch so progress is preserved if later batches fail
    save_auto_tags(existing_tags, tags_path)
  }

  message("\nTagging complete.")
  invisible(existing_tags)
}

# Run if called directly
if (sys.nframe() == 0) {
  run_tagging()
}
