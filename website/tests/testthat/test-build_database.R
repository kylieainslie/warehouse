# test-build_database.R
# Tests for build_database.R functions

library(DBI)
library(RSQLite)

# ==============================================================================
# create_database() tests
# ==============================================================================

test_that("create_database creates a new database file", {
  db_path <- create_test_db()
  on.exit(cleanup_test_db(db_path))

  result <- create_database(db_path)

  expect_true(file.exists(db_path))
  expect_equal(result, db_path)
})

test_that("create_database creates packages table with correct schema", {
  db_path <- create_test_db()
  on.exit(cleanup_test_db(db_path))

  suppressMessages(create_database(db_path))

  con <- dbConnect(RSQLite::SQLite(), db_path)
  on.exit(dbDisconnect(con), add = TRUE)

  tables <- dbListTables(con)
  expect_true("packages" %in% tables)

  # Check columns
  cols <- dbListFields(con, "packages")
  expect_true("package_name" %in% cols)
  expect_true("title" %in% cols)
  expect_true("primary_category" %in% cols)
  expect_true("score" %in% cols)
  expect_true("stars" %in% cols)
})

test_that("create_database creates categories table", {
  db_path <- create_test_db()
  on.exit(cleanup_test_db(db_path))

  suppressMessages(create_database(db_path))

  con <- dbConnect(RSQLite::SQLite(), db_path)
  on.exit(dbDisconnect(con), add = TRUE)

  tables <- dbListTables(con)
  expect_true("categories" %in% tables)
})

test_that("create_database creates feedback table", {
  db_path <- create_test_db()
  on.exit(cleanup_test_db(db_path))

  suppressMessages(create_database(db_path))

  con <- dbConnect(RSQLite::SQLite(), db_path)
  on.exit(dbDisconnect(con), add = TRUE)

  tables <- dbListTables(con)
  expect_true("feedback" %in% tables)
})

test_that("create_database creates indexes", {
  db_path <- create_test_db()
  on.exit(cleanup_test_db(db_path))

  suppressMessages(create_database(db_path))

  con <- dbConnect(RSQLite::SQLite(), db_path)
  on.exit(dbDisconnect(con), add = TRUE)

  indexes <- dbGetQuery(con, "SELECT name FROM sqlite_master WHERE type='index'")

  expect_true("idx_packages_category" %in% indexes$name)
  expect_true("idx_packages_score" %in% indexes$name)
  expect_true("idx_packages_name" %in% indexes$name)
})

test_that("create_database is idempotent", {
  db_path <- create_test_db()
  on.exit(cleanup_test_db(db_path))

  # Run twice
  suppressMessages(create_database(db_path))
  expect_no_error(suppressMessages(create_database(db_path)))
})

# ==============================================================================
# insert_packages() tests
# ==============================================================================

test_that("insert_packages inserts new packages", {
  db_path <- create_test_db()
  on.exit(cleanup_test_db(db_path))

  suppressMessages(create_database(db_path))

  packages <- mock_scraped_packages(n = 3)
  result <- suppressMessages(insert_packages(packages, db_path))

  expect_equal(result$inserted, 3)
  expect_equal(result$updated, 0)
})

test_that("insert_packages updates existing packages", {
  db_path <- create_test_db()
  on.exit(cleanup_test_db(db_path))

  suppressMessages(create_database(db_path))

  # Insert initial packages
  packages <- mock_scraped_packages(n = 2)
  suppressMessages(insert_packages(packages, db_path))

  # Update with modified data
  packages$title <- paste("Updated", packages$title)
  result <- suppressMessages(insert_packages(packages, db_path))

  expect_equal(result$inserted, 0)
  expect_equal(result$updated, 2)
})

test_that("insert_packages handles mixed inserts and updates", {
  db_path <- create_test_db()
  on.exit(cleanup_test_db(db_path))

  suppressMessages(create_database(db_path))

  # Insert initial packages
  packages1 <- mock_scraped_packages(n = 2)
  suppressMessages(insert_packages(packages1, db_path))

  # Insert mix of new and existing
  packages2 <- mock_scraped_packages(n = 4)  # pkg1-pkg4
  result <- suppressMessages(insert_packages(packages2, db_path))

  expect_equal(result$inserted, 2)  # pkg3, pkg4 are new
  expect_equal(result$updated, 2)   # pkg1, pkg2 are updated
})

test_that("insert_packages converts list columns to JSON", {
  db_path <- create_test_db()
  on.exit(cleanup_test_db(db_path))

  suppressMessages(create_database(db_path))

  packages <- mock_scraped_packages(n = 1)
  packages$exports[[1]] <- c("func1", "func2", "func3")
  suppressMessages(insert_packages(packages, db_path))

  con <- dbConnect(RSQLite::SQLite(), db_path)
  on.exit(dbDisconnect(con), add = TRUE)

  result <- dbGetQuery(con, "SELECT exports FROM packages WHERE package_name = 'pkg1'")

  # Should be valid JSON
  expect_no_error(jsonlite::fromJSON(result$exports[1]))
})

# ==============================================================================
# get_packages_by_category() tests
# ==============================================================================

test_that("get_packages_by_category returns packages for existing category", {
  db_path <- create_test_db()
  on.exit(cleanup_test_db(db_path))

  suppressMessages(create_database(db_path))

  packages <- mock_scraped_packages(n = 5, category = "epidemiology")
  suppressMessages(insert_packages(packages, db_path))

  result <- get_packages_by_category("epidemiology", db_path)

  expect_s3_class(result, "tbl_df")
  expect_equal(nrow(result), 5)
  expect_true(all(result$primary_category == "epidemiology"))
})

test_that("get_packages_by_category returns empty tibble for non-existent category", {
  db_path <- create_test_db()
  on.exit(cleanup_test_db(db_path))

  suppressMessages(create_database(db_path))

  packages <- mock_scraped_packages(n = 3, category = "epidemiology")
  suppressMessages(insert_packages(packages, db_path))

  result <- get_packages_by_category("nonexistent", db_path)

  expect_equal(nrow(result), 0)
})

test_that("get_packages_by_category respects limit parameter", {
  db_path <- create_test_db()
  on.exit(cleanup_test_db(db_path))

  suppressMessages(create_database(db_path))

  packages <- mock_scraped_packages(n = 10, category = "spatial")
  suppressMessages(insert_packages(packages, db_path))

  result <- get_packages_by_category("spatial", db_path, limit = 3)

  expect_equal(nrow(result), 3)
})

test_that("get_packages_by_category orders by score descending", {
  db_path <- create_test_db()
  on.exit(cleanup_test_db(db_path))

  suppressMessages(create_database(db_path))

  packages <- mock_scraped_packages(n = 5, category = "visualization")
  packages$score <- c(0.1, 0.9, 0.5, 0.3, 0.7)
  suppressMessages(insert_packages(packages, db_path))

  result <- get_packages_by_category("visualization", db_path)

  # Should be sorted by score descending
  expect_equal(result$score, sort(result$score, decreasing = TRUE))
})

# ==============================================================================
# get_all_packages() tests
# ==============================================================================

test_that("get_all_packages returns all packages", {
  db_path <- create_test_db()
  on.exit(cleanup_test_db(db_path))

  suppressMessages(create_database(db_path))

  packages <- mock_scraped_packages(n = 7)
  suppressMessages(insert_packages(packages, db_path))

  result <- get_all_packages(db_path)

  expect_s3_class(result, "tbl_df")
  expect_equal(nrow(result), 7)
})

# ==============================================================================
# get_db_stats() tests
# ==============================================================================

test_that("get_db_stats returns correct total count", {
  db_path <- create_test_db()
  on.exit(cleanup_test_db(db_path))

  suppressMessages(create_database(db_path))

  packages <- mock_scraped_packages(n = 10)
  suppressMessages(insert_packages(packages, db_path))

  stats <- get_db_stats(db_path)

  expect_equal(stats$total_packages, 10)
})

test_that("get_db_stats returns packages by category breakdown", {
  db_path <- create_test_db()
  on.exit(cleanup_test_db(db_path))

  suppressMessages(create_database(db_path))

  # Insert packages with different categories
  pkg1 <- mock_scraped_packages(n = 3, category = "epidemiology")
  pkg2 <- mock_scraped_packages(n = 2, category = "spatial")
  pkg2$package_name <- paste0("spatial_", pkg2$package_name)  # Avoid duplicates

  suppressMessages(insert_packages(pkg1, db_path))
  suppressMessages(insert_packages(pkg2, db_path))

  stats <- get_db_stats(db_path)

  expect_true("packages_by_category" %in% names(stats))
  expect_s3_class(stats$packages_by_category, "data.frame")
})

test_that("get_db_stats calculates average score", {
  db_path <- create_test_db()
  on.exit(cleanup_test_db(db_path))

  suppressMessages(create_database(db_path))

  packages <- mock_scraped_packages(n = 4)
  packages$score <- c(0.2, 0.4, 0.6, 0.8)
  suppressMessages(insert_packages(packages, db_path))

  stats <- get_db_stats(db_path)

  expect_equal(stats$avg_score, 0.5, tolerance = 0.01)
})

test_that("get_db_stats handles empty database", {
  db_path <- create_test_db()
  on.exit(cleanup_test_db(db_path))

  suppressMessages(create_database(db_path))

  stats <- get_db_stats(db_path)

  expect_equal(stats$total_packages, 0)
  expect_equal(stats$total_feedback, 0)
})
