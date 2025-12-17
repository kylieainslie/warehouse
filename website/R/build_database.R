# build_database.R
# Create and populate SQLite database for The Warehouse

library(DBI)
library(RSQLite)
library(dplyr)
library(jsonlite)

# Default database path (relative to working directory)
DB_PATH <- file.path(getwd(), "data", "warehouse.sqlite")

#' Initialize the SQLite database with schema
#' @param db_path Path to the SQLite database file
create_database <- function(db_path = DB_PATH) {
  # Ensure data directory exists
  dir.create(dirname(db_path), showWarnings = FALSE, recursive = TRUE)

  con <- dbConnect(RSQLite::SQLite(), db_path)
  on.exit(dbDisconnect(con))

  message("Creating database schema...")

 # Packages table
  dbExecute(con, "
    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_name TEXT UNIQUE NOT NULL,
      title TEXT,
      description TEXT,
      version TEXT,
      maintainer TEXT,
      author TEXT,
      license TEXT,
      url TEXT,
      bug_reports TEXT,
      repository TEXT,
      exports TEXT,
      topics TEXT,
      dependencies TEXT,
      score REAL,
      stars INTEGER DEFAULT 0,
      registered TEXT,
      source_universe TEXT,
      primary_category TEXT,
      scraped_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  ")

  # Categories table
  dbExecute(con, "
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      display_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  ")

  # Package-Category junction table (many-to-many)
  dbExecute(con, "
    CREATE TABLE IF NOT EXISTS package_categories (
      package_id INTEGER,
      category_id INTEGER,
      PRIMARY KEY (package_id, category_id),
      FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    )
  ")

  # User feedback table
  dbExecute(con, "
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_id INTEGER NOT NULL,
      feedback_type TEXT CHECK(feedback_type IN ('rating', 'review', 'correction', 'suggestion')),
      rating INTEGER CHECK(rating >= 1 AND rating <= 5),
      comment TEXT,
      use_case TEXT,
      submitter_name TEXT,
      submitter_email TEXT,
      is_approved INTEGER DEFAULT 0,
      github_issue_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
    )
  ")

  # Create indexes for performance
  dbExecute(con, "CREATE INDEX IF NOT EXISTS idx_packages_category ON packages(primary_category)")
  dbExecute(con, "CREATE INDEX IF NOT EXISTS idx_packages_score ON packages(score DESC)")
  dbExecute(con, "CREATE INDEX IF NOT EXISTS idx_packages_name ON packages(package_name)")
  dbExecute(con, "CREATE INDEX IF NOT EXISTS idx_feedback_package ON feedback(package_id)")
  dbExecute(con, "CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug)")

  message("Database schema created at: ", db_path)
  invisible(db_path)
}

#' Seed initial categories
#' @param db_path Path to the SQLite database file
seed_categories <- function(db_path = DB_PATH) {
  con <- dbConnect(RSQLite::SQLite(), db_path)
  on.exit(dbDisconnect(con))

  categories <- tibble::tribble(
    ~slug, ~name, ~description, ~icon, ~display_order,
    "epidemiology", "Epidemiology", "Outbreak analysis, disease modeling, public health surveillance", "activity", 1,
    "tidyverse", "Data Wrangling", "Data manipulation, transformation, and tidying with tidyverse", "table", 2,
    "ropensci", "rOpenSci", "Peer-reviewed scientific R packages from rOpenSci", "check-circle", 3,
    "bioconductor", "Bioconductor", "Bioinformatics and computational biology packages", "dna", 4,
    "visualization", "Visualization", "Data visualization, plotting, and graphics", "bar-chart-2", 5,
    "statistical-modeling", "Statistical Modeling", "Regression, inference, and statistical analysis", "trending-up", 6,
    "machine-learning", "Machine Learning", "Predictive modeling and ML algorithms", "cpu", 7,
    "data-import", "Data Import/Export", "Reading and writing various data formats", "upload", 8
  )

  # Use INSERT OR IGNORE to avoid duplicates
  for (i in seq_len(nrow(categories))) {
    row <- categories[i, ]
    dbExecute(con, "
      INSERT OR IGNORE INTO categories (slug, name, description, icon, display_order)
      VALUES (?, ?, ?, ?, ?)
    ", unname(as.list(row)))
  }

  message("Categories seeded")
}

#' Insert or update packages from scraped data
#' @param packages_df A tibble from scrape_all_universes()
#' @param db_path Path to the SQLite database file
insert_packages <- function(packages_df, db_path = DB_PATH) {
  con <- dbConnect(RSQLite::SQLite(), db_path)
  on.exit(dbDisconnect(con))

  message(sprintf("Inserting %d packages...", nrow(packages_df)))

  # Prepare data for insertion - convert lists to JSON strings
  packages_db <- packages_df |>
    mutate(
      exports = sapply(exports, function(x) {
        if (is.null(x) || length(x) == 0) "[]" else toJSON(x, auto_unbox = FALSE)
      }),
      topics = sapply(topics, function(x) {
        if (is.null(x) || length(x) == 0) "[]" else toJSON(x, auto_unbox = FALSE)
      }),
      dependencies = sapply(dependencies, function(x) {
        if (is.null(x) || length(x) == 0) "[]" else toJSON(x, auto_unbox = FALSE)
      })
    )

  dbExecute(con, "BEGIN TRANSACTION")

  inserted <- 0
  updated <- 0

  for (i in seq_len(nrow(packages_db))) {
    row <- packages_db[i, ]

    # Check if package exists
    existing <- dbGetQuery(con, "SELECT id FROM packages WHERE package_name = ?",
                          params = list(row$package_name))

    if (nrow(existing) == 0) {
      # Insert new package
      dbExecute(con, "
        INSERT INTO packages (
          package_name, title, description, version, maintainer, author,
          license, url, bug_reports, repository, exports, topics, dependencies,
          score, stars, registered, source_universe, primary_category, scraped_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ", list(
        row$package_name, row$title, row$description, row$version,
        row$maintainer, row$author, row$license, row$url, row$bug_reports,
        row$repository, row$exports, row$topics, row$dependencies,
        row$score, row$stars, row$registered, row$source_universe,
        row$primary_category, as.character(row$scraped_at)
      ))
      inserted <- inserted + 1
    } else {
      # Update existing package (preserve feedback by not touching that table)
      dbExecute(con, "
        UPDATE packages SET
          title = ?,
          description = ?,
          version = ?,
          maintainer = ?,
          author = ?,
          license = ?,
          url = ?,
          bug_reports = ?,
          repository = ?,
          exports = ?,
          topics = ?,
          dependencies = ?,
          score = ?,
          stars = ?,
          registered = ?,
          source_universe = ?,
          primary_category = ?,
          scraped_at = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE package_name = ?
      ", list(
        row$title, row$description, row$version, row$maintainer, row$author,
        row$license, row$url, row$bug_reports, row$repository,
        row$exports, row$topics, row$dependencies, row$score, row$stars,
        row$registered, row$source_universe, row$primary_category,
        as.character(row$scraped_at), row$package_name
      ))
      updated <- updated + 1
    }
  }

  dbExecute(con, "COMMIT")

  message(sprintf("Inserted %d new packages, updated %d existing packages", inserted, updated))
  invisible(list(inserted = inserted, updated = updated))
}

#' Get packages by category
#' @param category_slug The category slug
#' @param db_path Path to the SQLite database file
#' @param limit Maximum number of packages to return
#' @return A tibble of packages
get_packages_by_category <- function(category_slug, db_path = DB_PATH, limit = 100) {
  con <- dbConnect(RSQLite::SQLite(), db_path)
  on.exit(dbDisconnect(con))

  dbGetQuery(con, "
    SELECT * FROM packages
    WHERE primary_category = ?
    ORDER BY score DESC
    LIMIT ?
  ", params = list(category_slug, limit)) |>
    as_tibble()
}

#' Get all packages
#' @param db_path Path to the SQLite database file
#' @return A tibble of all packages
get_all_packages <- function(db_path = DB_PATH) {
  con <- dbConnect(RSQLite::SQLite(), db_path)
  on.exit(dbDisconnect(con))

  dbGetQuery(con, "SELECT * FROM packages ORDER BY score DESC") |>
    as_tibble()
}

#' Get database statistics
#' @param db_path Path to the SQLite database file
#' @return A list of statistics
get_db_stats <- function(db_path = DB_PATH) {
  con <- dbConnect(RSQLite::SQLite(), db_path)
  on.exit(dbDisconnect(con))

  list(
    total_packages = dbGetQuery(con, "SELECT COUNT(*) as n FROM packages")$n,
    packages_by_category = dbGetQuery(con, "
      SELECT primary_category, COUNT(*) as n
      FROM packages
      GROUP BY primary_category
      ORDER BY n DESC
    "),
    total_feedback = dbGetQuery(con, "SELECT COUNT(*) as n FROM feedback")$n,
    avg_score = dbGetQuery(con, "SELECT AVG(score) as avg FROM packages WHERE score IS NOT NULL")$avg
  )
}

#' Main function to build the database from scraped data
#' @param scraped_path Path to the scraped packages RDS file
#' @param db_path Path to the SQLite database file
build_database <- function(scraped_path = file.path(getwd(), "data", "scraped_packages.rds"),
                          db_path = DB_PATH) {
  # Create schema
  create_database(db_path)

  # Seed categories
  seed_categories(db_path)

  # Load scraped data
  if (!file.exists(scraped_path)) {
    stop("Scraped data not found at: ", scraped_path, "\nRun scrape_packages.R first.")
  }

  packages <- readRDS(scraped_path)
  message(sprintf("Loaded %d packages from %s", nrow(packages), scraped_path))

  # Insert packages
  insert_packages(packages, db_path)

  # Print stats
  stats <- get_db_stats(db_path)
  message("\nDatabase statistics:")
  message(sprintf("  Total packages: %d", stats$total_packages))
  message(sprintf("  Average score: %.2f", stats$avg_score))
  message("  Packages by category:")
  for (i in seq_len(nrow(stats$packages_by_category))) {
    row <- stats$packages_by_category[i, ]
    message(sprintf("    %s: %d", row$primary_category, row$n))
  }

  invisible(db_path)
}

# Run if called directly
if (sys.nframe() == 0) {
  build_database()
}
