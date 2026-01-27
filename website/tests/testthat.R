#!/usr/bin/env Rscript
# Test runner for The Warehouse R pipeline
# Run with: cd website && Rscript tests/testthat.R

# Ensure we're in the website directory
# The script expects to be run from website/ directory

# Load required packages
library(testthat)

# Source setup file
source("tests/setup.R")

# Run tests with progress reporter
test_results <- test_dir(
  "tests/testthat",
  reporter = ProgressReporter$new(show_praise = FALSE),
  stop_on_failure = FALSE
)

# Print summary
results_df <- as.data.frame(test_results)
total_pass <- sum(results_df$passed)
total_fail <- sum(results_df$failed)
total_skip <- sum(results_df$skipped)
total_warn <- sum(results_df$warning)

cat("\n")
cat(sprintf("Test Summary: %d passed, %d failed, %d skipped, %d warnings\n",
            total_pass, total_fail, total_skip, total_warn))

# Exit with appropriate code
if (any(as.data.frame(test_results)$failed > 0)) {
  quit(status = 1)
}
