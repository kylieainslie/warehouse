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
  expect_equal(result$usedby, 0L)
  expect_equal(result$score, 0)
  expect_equal(result$maintainer, "")
})

test_that("extract_package_info reads search API fields", {
  pkg <- mock_package_data(name = "testpkg", stars = 42L, usedby = 7L, score = 12.5)
  result <- extract_package_info(pkg)

  expect_equal(result$stars, 42L)
  expect_equal(result$usedby, 7L)
  expect_equal(result$score, 12.5)
  expect_equal(result$maintainer, "Test Author")
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
# get_hidden_gems() tests
# ==============================================================================

test_that("get_hidden_gems returns requested number of packages", {
  packages <- lapply(1:20, function(i) {
    mock_package_data(name = paste0("pkg", i), score = i)
  })

  result <- suppressMessages(get_hidden_gems(packages, n = 5))
  expect_equal(length(result), 5)
})

test_that("get_hidden_gems ranks high quality, low visibility packages first", {
  packages <- list(
    mock_package_data(name = "famous", score = 20, stars = 5000L, usedby = 500L),
    mock_package_data(name = "gem", score = 15, stars = 10L, usedby = 5L),
    mock_package_data(name = "middling", score = 15, stars = 300L, usedby = 20L)
  )

  result <- suppressMessages(get_hidden_gems(packages, n = 3))

  expect_equal(sapply(result, `[[`, "name"), c("gem", "middling", "famous"))
})

test_that("get_hidden_gems uses reverse deps when a package has no stars", {
  # Packages not hosted on GitHub (e.g. zoo, Matrix) have 0 stars but are
  # widely used, so they should not rank as hidden gems
  packages <- list(
    mock_package_data(name = "widely_used", score = 15, stars = 0L, usedby = 3000L),
    mock_package_data(name = "gem", score = 15, stars = 10L, usedby = 5L)
  )

  result <- suppressMessages(get_hidden_gems(packages, n = 2))

  expect_equal(result[[1]]$name, "gem")
})

test_that("get_hidden_gems excludes packages with non-positive scores", {
  packages <- list(
    mock_package_data(name = "zero", score = 0, stars = 0L, usedby = 0L),
    mock_package_data(name = "valid", score = 5)
  )

  result <- suppressMessages(get_hidden_gems(packages, n = 5))

  expect_equal(sapply(result, `[[`, "name"), "valid")
})

test_that("get_hidden_gems filters out packages with missing names", {
  packages <- list(
    mock_package_data(name = "valid", score = 5),
    list(`_score` = 50, Title = "No name")
  )

  result <- suppressMessages(get_hidden_gems(packages, n = 5))

  expect_equal(sapply(result, `[[`, "name"), "valid")
})

test_that("get_hidden_gems handles empty input", {
  result <- suppressMessages(get_hidden_gems(list(), n = 5))
  expect_equal(length(result), 0)
})

test_that("get_hidden_gems handles fewer packages than requested", {
  packages <- list(
    mock_package_data(name = "pkg1", score = 5),
    mock_package_data(name = "pkg2", score = 6)
  )

  result <- suppressMessages(get_hidden_gems(packages, n = 10))
  expect_equal(length(result), 2)
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
