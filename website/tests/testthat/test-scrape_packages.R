# test-scrape_packages.R
# Tests for scrape_packages.R functions

# Note: The %||% operator in scrape_packages.R is simpler than fetch_discover.R
# We test the scrape_packages.R version here

# ==============================================================================
# %||% operator tests (scrape_packages.R version)
# ==============================================================================

# Define a test function for the scrape_packages.R version of %||%
# (simpler version that only checks for NULL/empty, not NA)
null_coalesce_simple <- function(x, y) if (is.null(x) || length(x) == 0) y else x

test_that("null coalesce returns right side for NULL", {
  expect_equal(null_coalesce_simple(NULL, "default"), "default")
})

test_that("null coalesce returns right side for empty vector", {
  expect_equal(null_coalesce_simple(character(0), "default"), "default")
  expect_equal(null_coalesce_simple(integer(0), 0L), 0L)
  expect_equal(null_coalesce_simple(list(), list(a = 1)), list(a = 1))
})

test_that("null coalesce returns left side for non-empty values", {
  expect_equal(null_coalesce_simple("value", "default"), "value")
  expect_equal(null_coalesce_simple(42, 0), 42)
  expect_equal(null_coalesce_simple(list(a = 1), list()), list(a = 1))
})

test_that("null coalesce returns left side for NA (differs from fetch_discover version)", {
  # scrape_packages.R version doesn't check for NA
  expect_true(is.na(null_coalesce_simple(NA, "default")))
})

# ==============================================================================
# categorize_by_keywords() tests
# ==============================================================================

test_that("categorize_by_keywords preserves non-general categories", {
  packages <- tibble(
    package_name = "epiR",
    title = "Epidemiological Tools",
    description = "Tools for epidemiology with machine learning",
    primary_category = "epidemiology"  # Already categorized
  )

  result <- suppressMessages(categorize_by_keywords(packages))

  # Should keep epidemiology, not change to machine-learning
  expect_equal(result$primary_category[1], "epidemiology")
})

test_that("categorize_by_keywords assigns epidemiology for relevant keywords", {
  packages <- tibble(
    package_name = c("outbreak", "disease_model"),
    title = c("Outbreak Analysis", "Disease Transmission Model"),
    description = c("Analyze disease outbreaks", "Model infectious disease transmission"),
    primary_category = c("general", "general")
  )

  result <- suppressMessages(categorize_by_keywords(packages))

  expect_equal(result$primary_category, c("epidemiology", "epidemiology"))
})

test_that("categorize_by_keywords assigns spatial for relevant keywords", {
  packages <- tibble(
    package_name = c("geotools", "mapmaker"),
    title = c("Geospatial Analysis", "Mapping Tools"),
    description = c("GIS and spatial analysis", "Create maps with raster data"),
    primary_category = c("general", "general")
  )

  result <- suppressMessages(categorize_by_keywords(packages))

  expect_equal(result$primary_category, c("spatial", "spatial"))
})

test_that("categorize_by_keywords assigns machine-learning for relevant keywords", {
  packages <- tibble(
    package_name = c("mltools", "deepnet"),
    title = c("Machine Learning Tools", "Deep Neural Networks"),
    description = c("Machine learning algorithms", "Deep learning with keras"),
    primary_category = c("general", "general")
  )

  result <- suppressMessages(categorize_by_keywords(packages))

  expect_equal(result$primary_category, c("machine-learning", "machine-learning"))
})

test_that("categorize_by_keywords assigns statistics for relevant keywords", {
  packages <- tibble(
    package_name = c("bayestools", "survmodel"),
    title = c("Bayesian Tools", "Survival Analysis"),
    description = c("MCMC and posterior analysis", "Hazard models and survival curves"),
    primary_category = c("general", "general")
  )

  result <- suppressMessages(categorize_by_keywords(packages))

  expect_equal(result$primary_category, c("statistics", "statistics"))
})

test_that("categorize_by_keywords assigns visualization for relevant keywords", {
  packages <- tibble(
    package_name = c("plotmaker", "dashapp"),
    title = c("Interactive Plots", "Shiny Dashboard"),
    description = c("Create interactive charts", "Build shiny dashboards"),
    primary_category = c("general", "general")
  )

  result <- suppressMessages(categorize_by_keywords(packages))

  expect_equal(result$primary_category, c("visualization", "visualization"))
})

test_that("categorize_by_keywords assigns bioinformatics for relevant keywords", {
  packages <- tibble(
    package_name = c("geneseq", "proteintools"),
    title = c("Gene Sequencing", "Protein Analysis"),
    description = c("DNA and RNA sequencing analysis", "Proteomics data processing"),
    primary_category = c("general", "general")
  )

  result <- suppressMessages(categorize_by_keywords(packages))

  expect_equal(result$primary_category, c("bioinformatics", "bioinformatics"))
})

test_that("categorize_by_keywords keeps general for unmatched packages", {
  packages <- tibble(
    package_name = "genericpkg",
    title = "A Generic Package",
    description = "Does generic things with data",
    primary_category = "general"
  )

  result <- suppressMessages(categorize_by_keywords(packages))

  expect_equal(result$primary_category[1], "general")
})

test_that("categorize_by_keywords is case insensitive", {
  packages <- tibble(
    package_name = "EPIDEMICS",
    title = "EPIDEMIC MODELING",
    description = "INFECTIOUS DISEASE TRANSMISSION",
    primary_category = "general"
  )

  result <- suppressMessages(categorize_by_keywords(packages))

  expect_equal(result$primary_category[1], "epidemiology")
})

test_that("categorize_by_keywords handles NA values in title/description", {
  packages <- tibble(
    package_name = "natest",
    title = NA_character_,
    description = "Analyze disease outbreaks",
    primary_category = "general"
  )

  result <- suppressMessages(categorize_by_keywords(packages))

  expect_equal(result$primary_category[1], "epidemiology")
})

test_that("categorize_by_keywords removes search_text column", {
  packages <- tibble(
    package_name = "test",
    title = "Test",
    description = "Test package",
    primary_category = "general"
  )

  result <- suppressMessages(categorize_by_keywords(packages))

  expect_false("search_text" %in% names(result))
})
