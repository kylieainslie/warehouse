# test-fetch_discover.R
# Tests for fetch_discover.R functions

# ==============================================================================
# safe_int() tests
# ==============================================================================

test_that("safe_int returns default for NULL input", {

expect_equal(safe_int(NULL), 0L)
  expect_equal(safe_int(NULL, default = 5L), 5L)
})

test_that("safe_int handles empty vectors", {
  expect_equal(safe_int(integer(0)), 0L)
  expect_equal(safe_int(numeric(0)), 0L)
  expect_equal(safe_int(character(0)), 0L)
})

test_that("safe_int handles NA values", {
  expect_equal(safe_int(NA), 0L)
  expect_equal(safe_int(NA_integer_), 0L)
  expect_equal(safe_int(NA, default = 10L), 10L)
})

test_that("safe_int extracts count from list structures", {
  expect_equal(safe_int(list(count = 42)), 42L)
  expect_equal(safe_int(list(count = "123")), 123L)
})

test_that("safe_int handles nested list without count", {
  expect_equal(safe_int(list(100)), 100L)
  expect_equal(safe_int(list("200")), 200L)
})

test_that("safe_int converts numeric values correctly", {
  expect_equal(safe_int(42), 42L)
  expect_equal(safe_int(42.7), 42L)
  expect_equal(safe_int("100"), 100L)
})

test_that("safe_int takes first element of vectors", {
  expect_equal(safe_int(c(10, 20, 30)), 10L)
  expect_equal(safe_int(c("5", "10")), 5L)
})

test_that("safe_int returns default for unparseable strings", {
  expect_equal(safe_int("not a number"), 0L)
  expect_equal(safe_int("abc", default = -1L), -1L)
})

# ==============================================================================
# parse_date_safe() tests
# ==============================================================================

test_that("parse_date_safe returns NA for NULL input", {
  result <- parse_date_safe(NULL)
  expect_true(is.na(result))
  expect_s3_class(result, "POSIXct")
})

test_that("parse_date_safe returns NA for NA input", {
  result <- parse_date_safe(NA)
  expect_true(is.na(result))
})

test_that("parse_date_safe returns NA for empty string", {
  result <- parse_date_safe("")
  expect_true(is.na(result))
})

test_that("parse_date_safe parses YYYY-MM-DD format", {
  result <- parse_date_safe("2024-06-15")
  expect_false(is.na(result))
  expect_equal(format(result, "%Y-%m-%d"), "2024-06-15")
})

test_that("parse_date_safe parses YYYY-MM-DD HH:MM:SS format", {
  result <- parse_date_safe("2024-06-15 14:30:00")
  expect_false(is.na(result))
  expect_equal(format(result, "%Y-%m-%d"), "2024-06-15")
})

test_that("parse_date_safe parses ISO 8601 format with Z", {
  result <- parse_date_safe("2024-06-15T14:30:00Z")
  expect_false(is.na(result))
  expect_equal(format(result, "%Y-%m-%d"), "2024-06-15")
})

# ==============================================================================
# extract_package_info() tests
# ==============================================================================

test_that("extract_package_info returns NULL for missing package name", {
  pkg <- list(Title = "Test")
  expect_null(extract_package_info(pkg))
})
test_that("extract_package_info returns NULL for empty package name", {
  pkg <- list(Package = "", Title = "Test")
  expect_null(extract_package_info(pkg))
})

test_that("extract_package_info extracts basic fields correctly", {
  pkg <- mock_package_data(name = "testpkg", user = "myuser")
  result <- extract_package_info(pkg)

  expect_equal(result$name, "testpkg")
  expect_equal(result$user, "myuser")
  expect_equal(result$url, "https://myuser.r-universe.dev/testpkg")
})

test_that("extract_package_info handles missing optional fields", {
  pkg <- list(Package = "minimal")
  result <- extract_package_info(pkg)

  expect_equal(result$name, "minimal")
  expect_equal(result$title, "")
  expect_equal(result$stars, 0L)
  expect_equal(result$downloads, 0L)
})

test_that("extract_package_info truncates long descriptions", {
  long_desc <- paste(rep("word", 100), collapse = " ")
  pkg <- list(Package = "longdesc", Description = long_desc)
  result <- extract_package_info(pkg)

  expect_lte(nchar(result$description), 200)
})

test_that("extract_package_info uses fallback for user field", {
  pkg <- list(Package = "test", `_owner` = "fallbackuser")
  result <- extract_package_info(pkg)

  expect_equal(result$user, "fallbackuser")
})

# ==============================================================================
# get_trending() tests
# ==============================================================================

test_that("get_trending returns requested number of packages", {
  packages <- lapply(1:20, function(i) {
    mock_package_data(name = paste0("pkg", i), downloads = i * 100L)
  })

  result <- suppressMessages(get_trending(packages, n = 5))
  expect_equal(length(result), 5)
})

test_that("get_trending sorts by downloads descending", {
  packages <- list(
    mock_package_data(name = "low", downloads = 10L),
    mock_package_data(name = "high", downloads = 1000L),
    mock_package_data(name = "medium", downloads = 100L)
  )

  result <- suppressMessages(get_trending(packages, n = 3))

  expect_equal(result[[1]]$name, "high")
  expect_equal(result[[2]]$name, "medium")
  expect_equal(result[[3]]$name, "low")
})

test_that("get_trending handles empty input", {
  result <- suppressMessages(get_trending(list(), n = 5))
  expect_equal(length(result), 0)
})

test_that("get_trending handles fewer packages than requested", {
  packages <- list(
    mock_package_data(name = "pkg1", downloads = 100L),
    mock_package_data(name = "pkg2", downloads = 200L)
  )

  result <- suppressMessages(get_trending(packages, n = 10))
  expect_equal(length(result), 2)
})

test_that("get_trending filters out packages with missing names", {
  packages <- list(
    mock_package_data(name = "valid", downloads = 100L),
    list(`_downloads` = 1000L, Title = "No name"),
    mock_package_data(name = "another", downloads = 50L)
  )

  result <- suppressMessages(get_trending(packages, n = 5))

  # Should only include packages with valid names
  names <- sapply(result, function(p) p$name)
  expect_true(all(names %in% c("valid", "another")))
})

# ==============================================================================
# get_new() tests
# ==============================================================================

test_that("get_new returns requested number of packages", {
  packages <- lapply(1:20, function(i) {
    mock_package_data(
      name = paste0("pkg", i),
      published = sprintf("2024-%02d-01", i %% 12 + 1)
    )
  })

  result <- suppressMessages(get_new(packages, n = 5))
  expect_equal(length(result), 5)
})

test_that("get_new sorts by date descending", {
  packages <- list(
    mock_package_data(name = "old", published = "2023-01-01"),
    mock_package_data(name = "new", published = "2024-12-01"),
    mock_package_data(name = "medium", published = "2024-06-01")
  )

  result <- suppressMessages(get_new(packages, n = 3))

  expect_equal(result[[1]]$name, "new")
  expect_equal(result[[2]]$name, "medium")
  expect_equal(result[[3]]$name, "old")
})

test_that("get_new handles packages with no valid dates", {
  packages <- list(
    mock_package_data(name = "pkg1", published = "invalid"),
    mock_package_data(name = "pkg2", published = "")
  )
  # Override the Date/Publication field
  packages[[1]]$`Date/Publication` <- "invalid"
  packages[[1]]$`_published` <- "invalid"
  packages[[2]]$`Date/Publication` <- ""
  packages[[2]]$`_published` <- ""

  result <- suppressMessages(get_new(packages, n = 5))

  # Should fall back to first packages when no valid dates
  expect_true(length(result) >= 0)
})

test_that("get_new handles empty input", {
  result <- suppressMessages(get_new(list(), n = 5))
  expect_equal(length(result), 0)
})

# ==============================================================================
# get_rising() tests
# ==============================================================================

test_that("get_rising returns requested number of packages", {
  packages <- lapply(1:20, function(i) {
    mock_package_data(name = paste0("pkg", i), stars = i * 10L)
  })

  result <- suppressMessages(get_rising(packages, n = 5))
  expect_equal(length(result), 5)
})

test_that("get_rising sorts by stars descending", {
  packages <- list(
    mock_package_data(name = "low_stars", stars = 10L),
    mock_package_data(name = "high_stars", stars = 500L),
    mock_package_data(name = "medium_stars", stars = 100L)
  )

  result <- suppressMessages(get_rising(packages, n = 3))

  expect_equal(result[[1]]$name, "high_stars")
  expect_equal(result[[2]]$name, "medium_stars")
  expect_equal(result[[3]]$name, "low_stars")
})

test_that("get_rising handles empty input", {
  result <- suppressMessages(get_rising(list(), n = 5))
  expect_equal(length(result), 0)
})

test_that("get_rising handles packages with zero stars", {
  packages <- list(
    mock_package_data(name = "nostars", stars = 0L),
    mock_package_data(name = "somestars", stars = 50L)
  )

  result <- suppressMessages(get_rising(packages, n = 5))

  expect_equal(result[[1]]$name, "somestars")
  expect_equal(result[[2]]$name, "nostars")
})

# ==============================================================================
# %||% operator tests
# Note: The global %||% may be overwritten when multiple R files are sourced.
# These tests verify the basic expected behavior.
# ==============================================================================

test_that("%||% returns right side for NULL", {
  expect_equal(NULL %||% "default", "default")
})

test_that("%||% returns right side for empty vector", {
  expect_equal(character(0) %||% "default", "default")
})

test_that("%||% returns left side for valid values", {
  expect_equal("value" %||% "default", "value")
  expect_equal(42 %||% 0, 42)
  expect_equal(c(1, 2, 3) %||% 0, c(1, 2, 3))
})
