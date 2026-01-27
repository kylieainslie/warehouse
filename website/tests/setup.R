# setup.R
# Global test configuration for The Warehouse R pipeline tests

library(testthat)
library(dplyr)
library(tibble)

# Source helper files
source("tests/helpers/helper-mocks.R")

# Source the R files being tested (without running their main blocks)
# We need to define a guard to prevent main execution
.TESTING <- TRUE

# Source each file, suppressing messages during loading
suppressMessages({
  source("R/fetch_discover.R")
  source("R/scrape_rweekly.R")
  source("R/scrape_packages.R")
  source("R/build_database.R")
})

# Path to fixtures directory
FIXTURES_DIR <- "tests/fixtures"

#' Load a fixture file
#' @param filename Name of the fixture file
#' @return Contents of the fixture file as a character string
load_fixture <- function(filename) {
  path <- file.path(FIXTURES_DIR, filename)
  if (!file.exists(path)) {
    stop("Fixture not found: ", filename)
  }
  paste(readLines(path, warn = FALSE), collapse = "\n")
}

#' Create a temporary database for testing
#' @return Path to the temporary database file
create_test_db <- function() {
  tempfile(fileext = ".sqlite")
}

#' Clean up a test database
#' @param db_path Path to the database file to remove
cleanup_test_db <- function(db_path) {
  if (file.exists(db_path)) {
    unlink(db_path)
  }
}
