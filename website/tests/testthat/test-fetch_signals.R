# test-fetch_signals.R
# Tests for fetch_signals.R functions

# ==============================================================================
# count_revdeps() tests
# ==============================================================================

test_that("count_revdeps counts unique packages across fields", {
  result <- count_revdeps(
    c("a, b", NA, "x"),
    c("b, c", NA, NA),
    c(NA, "z", NA)
  )
  expect_equal(result, c(3L, 1L, 1L))
})

test_that("count_revdeps returns 0 when nothing depends on a package", {
  expect_equal(count_revdeps(NA_character_, NA_character_), 0L)
  expect_equal(count_revdeps("", " "), 0L)
})

test_that("count_revdeps handles empty input", {
  expect_equal(count_revdeps(character(0)), integer(0))
})

# ==============================================================================
# fetch_cran_metadata() tests
# ==============================================================================

write_cran_db <- function(df) {
  path <- tempfile(fileext = ".rds")
  saveRDS(as.matrix(df), path)
  paste0("file://", normalizePath(path))
}

test_that("fetch_cran_metadata extracts release dates and revdep counts", {
  url <- write_cran_db(data.frame(
    Package = c("mice", "lonely"),
    Version = c("3.19.0", "0.1"),
    Published = c("2025-12-10 08:30:02 UTC", "2019-01-02"),
    `Reverse depends` = c("miceadds, micemd", NA),
    `Reverse imports` = c("finalfit, miceadds", NA),
    `Reverse linking to` = c(NA, NA),
    `Reverse suggests` = c("brms, Hmisc", "foo"),
    check.names = FALSE, stringsAsFactors = FALSE
  ))

  result <- suppressMessages(fetch_cran_metadata(url))

  expect_equal(result$package_name, c("mice", "lonely"))
  expect_equal(result$cran_version, c("3.19.0", "0.1"))
  expect_equal(result$published, c("2025-12-10", "2019-01-02"))
  # Suggests are optional, so they don't count
  expect_equal(result$revdeps, c(3L, 0L))
})

test_that("fetch_cran_metadata copes with missing reverse dependency columns", {
  url <- write_cran_db(data.frame(
    Package = "pkg", Version = "1.0", Published = "2024-05-01", stringsAsFactors = FALSE
  ))

  result <- suppressMessages(fetch_cran_metadata(url))
  expect_equal(result$revdeps, 0L)
})

# ==============================================================================
# build_signals() tests
# ==============================================================================

test_that("build_signals combines metadata and downloads by package name", {
  metadata <- tibble(package_name = c("a", "b"),
                     cran_version = c("1.0", "2.1"),
                     published = c("2025-01-01", "2020-06-30"),
                     revdeps = c(5L, 0L))
  downloads <- tibble(package_name = c("b", "a"), downloads = c(10L, 2000L))

  result <- build_signals(metadata, downloads)

  expect_equal(names(result), c("a", "b"))
  expect_equal(result$a, list(cran_version = "1.0", published = "2025-01-01",
                           downloads = 2000L, revdeps = 5L))
  expect_equal(result$b$downloads, 10L)
})

test_that("build_signals omits unknown fields instead of writing NA", {
  metadata <- tibble(package_name = "a", cran_version = NA_character_,
                     published = NA_character_, revdeps = 1L)
  downloads <- tibble(package_name = character(0), downloads = integer(0))

  result <- build_signals(metadata, downloads)

  expect_equal(result$a, list(revdeps = 1L))
})

# ==============================================================================
# run_signals_fetch() tests
# ==============================================================================

test_that("run_signals_fetch keeps the existing file when CRAN is unreachable", {
  path <- tempfile(fileext = ".json")
  writeLines('{"packages":{"keep":{"revdeps":1}}}', path)

  missing_url <- paste0("file://", tempfile(fileext = ".rds"))
  suppressMessages(
    expect_warning(expect_warning(run_signals_fetch(path, missing_url), "CRAN metadata"),
                   "keeping existing")
  )

  expect_equal(readLines(path), '{"packages":{"keep":{"revdeps":1}}}')
})
