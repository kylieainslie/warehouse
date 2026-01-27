# helper-mocks.R
# Mock utilities for HTTP responses and test data creation

library(tibble)

#' Create a mock package data structure (as returned from R-universe API)
#' @param name Package name
#' @param downloads Number of downloads
#' @param stars Number of GitHub stars
#' @param published Publication date string
#' @param score Package score
#' @param user Universe user/owner
#' @return A list mimicking R-universe API package data
mock_package_data <- function(
  name = "testpkg",
  downloads = 100L,
  stars = 50L,
  published = "2024-01-15",
  score = 0.8,
  user = "testuser"
) {
  list(
    Package = name,
    Title = paste("Title for", name),
    Description = paste("Description for package", name),
    Version = "1.0.0",
    `_downloads` = downloads,
    `_stars` = stars,
    `_score` = score,
    `_user` = user,
    `_owner` = user,
    `_usedby` = 10L,
    `Date/Publication` = published,
    `_published` = published,
    `_created` = "2023-01-01",
    Maintainer = "Test Author <test@example.com>"
  )
}

#' Create a mock scraped packages tibble
#' @param n Number of packages to create
#' @param category Primary category for all packages
#' @return A tibble matching the scraped packages format
mock_scraped_packages <- function(n = 5, category = "epidemiology") {
  tibble(
    package_name = paste0("pkg", seq_len(n)),
    title = paste("Package", seq_len(n), "Title"),
    description = paste("Description for package", seq_len(n)),
    version = "1.0.0",
    maintainer = "Test Maintainer <test@example.com>",
    author = "Test Author",
    license = "MIT",
    url = paste0("https://example.com/pkg", seq_len(n)),
    bug_reports = paste0("https://github.com/test/pkg", seq_len(n), "/issues"),
    repository = paste0("https://github.com/test/pkg", seq_len(n)),
    exports = replicate(n, list(c("func1", "func2")), simplify = FALSE),
    topics = replicate(n, list(c("topic1", "topic2")), simplify = FALSE),
    dependencies = replicate(n, list(list()), simplify = FALSE),
    score = runif(n, 0.5, 1.0),
    stars = sample(10:100, n, replace = TRUE),
    registered = as.character(Sys.Date()),
    source_universe = "test-universe",
    primary_category = category,
    scraped_at = Sys.time()
  )
}

#' Create mock R Weekly section content for testing parsing
#' @param packages Character vector of package names to include
#' @return A string of markdown content mimicking R Weekly format
mock_rweekly_section <- function(packages = c("dplyr", "ggplot2")) {
  entries <- sapply(packages, function(pkg) {
    sprintf("+ [{%s} 1.0.0](https://cran.r-project.org/package=%s) - A great package for data analysis.",
            pkg, pkg)
  })
  paste(entries, collapse = "\n")
}

#' Create a mock R Weekly post content
#' @param new_packages Character vector of new package names
#' @param updated_packages Character vector of updated package names
#' @return Full mock R Weekly post markdown
mock_rweekly_post <- function(
  new_packages = c("newpkg1", "newpkg2"),
  updated_packages = c("updatedpkg1")
) {
  new_section <- if (length(new_packages) > 0) {
    paste0("### New Packages\n\n", mock_rweekly_section(new_packages))
  } else ""

  updated_section <- if (length(updated_packages) > 0) {
    paste0("### Updated Packages\n\n", mock_rweekly_section(updated_packages))
  } else ""

  paste(
    "---",
    "title: R Weekly 2024-W01",
    "---",
    "",
    "## Highlights",
    "",
    "Some highlights this week.",
    "",
    new_section,
    "",
    updated_section,
    "",
    "## Resources",
    "",
    "Some resources.",
    sep = "\n"
  )
}
