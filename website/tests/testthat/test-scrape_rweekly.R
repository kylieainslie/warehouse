# test-scrape_rweekly.R
# Tests for scrape_rweekly.R parsing functions

library(stringr)

# ==============================================================================
# extract_section() tests
# ==============================================================================

test_that("extract_section finds New Packages section", {
  content <- mock_rweekly_post(
    new_packages = c("dplyr", "ggplot2"),
    updated_packages = c("tidyr")
  )

  result <- extract_section(content, "New Packages")

  expect_true(nchar(result) > 0)
  expect_true(grepl("dplyr", result))
  expect_true(grepl("ggplot2", result))
})

test_that("extract_section finds Updated Packages section", {
  content <- mock_rweekly_post(
    new_packages = c("dplyr"),
    updated_packages = c("tidyr", "purrr")
  )

  result <- extract_section(content, "Updated Packages")

  expect_true(nchar(result) > 0)
  expect_true(grepl("tidyr", result))
  expect_true(grepl("purrr", result))
})

test_that("extract_section returns empty string for missing section", {
  content <- "# Some Header\n\nNo packages here.\n\n## Another Section"

  result <- extract_section(content, "New Packages")

  expect_equal(result, "")
})

test_that("extract_section handles section with ## header", {
  content <- paste(
    "## New Packages",
    "",
    "+ [{testpkg} 1.0](https://example.com) - A test package",
    "",
    "## Other Section",
    sep = "\n"
  )

  result <- extract_section(content, "New Packages")

  expect_true(grepl("testpkg", result))
})

test_that("extract_section handles section with ### header", {
  content <- paste(
    "### New Packages",
    "",
    "+ [{testpkg} 1.0](https://example.com) - A test package",
    "",
    "### Other Section",
    sep = "\n"
  )

  result <- extract_section(content, "New Packages")

  expect_true(grepl("testpkg", result))
})

test_that("extract_section is case insensitive", {
  content <- paste(
    "### NEW PACKAGES",
    "",
    "+ [{testpkg} 1.0](https://example.com) - A test package",
    "",
    "## Other",
    sep = "\n"
  )

  result <- extract_section(content, "New Packages")

  expect_true(grepl("testpkg", result))
})

# ==============================================================================
# parse_package_entries() tests
# ==============================================================================

test_that("parse_package_entries returns empty tibble for NULL input", {
  result <- parse_package_entries(NULL, "new")

  expect_s3_class(result, "tbl_df")
  expect_equal(nrow(result), 0)
  expect_true("package_name" %in% names(result))
})

test_that("parse_package_entries returns empty tibble for empty string", {
  result <- parse_package_entries("", "new")

  expect_equal(nrow(result), 0)
})

test_that("parse_package_entries extracts package name", {
  section <- "+ [{dplyr} 1.1.0](https://cran.r-project.org/package=dplyr) - Data manipulation"

  result <- parse_package_entries(section, "new")

  expect_equal(nrow(result), 1)
  expect_equal(result$package_name[1], "dplyr")
})

test_that("parse_package_entries extracts version", {
  section <- "+ [{ggplot2} 3.4.0](https://example.com) - Plotting"

  result <- parse_package_entries(section, "updated")

  expect_equal(str_trim(result$version[1]), "3.4.0")
})

test_that("parse_package_entries extracts URL", {
  section <- "+ [{tidyr} 1.0.0](https://cran.r-project.org/package=tidyr) - Tidy data"

  result <- parse_package_entries(section, "new")

  expect_equal(result$url[1], "https://cran.r-project.org/package=tidyr")
})

test_that("parse_package_entries extracts description", {
  section <- "+ [{purrr} 1.0.0](https://example.com) - Functional programming tools"

  result <- parse_package_entries(section, "new")

  expect_true(grepl("Functional programming", result$description[1]))
})

test_that("parse_package_entries handles multiple entries", {
  section <- paste(
    "+ [{pkg1} 1.0](https://example.com/1) - First package",
    "+ [{pkg2} 2.0](https://example.com/2) - Second package",
    "+ [{pkg3} 3.0](https://example.com/3) - Third package",
    sep = "\n"
  )

  result <- parse_package_entries(section, "new")

  expect_equal(nrow(result), 3)
  expect_equal(result$package_name, c("pkg1", "pkg2", "pkg3"))
})

test_that("parse_package_entries sets type correctly", {
  section <- "+ [{testpkg} 1.0](https://example.com) - Test"

  result_new <- parse_package_entries(section, "new")
  result_updated <- parse_package_entries(section, "updated")

  expect_equal(result_new$type[1], "new")
  expect_equal(result_updated$type[1], "updated")
})

test_that("parse_package_entries handles colon separator", {
  section <- "+ [{testpkg} 1.0](https://example.com): Description with colon"

  result <- parse_package_entries(section, "new")

  expect_equal(nrow(result), 1)
  expect_true(grepl("Description with colon", result$description[1]))
})
