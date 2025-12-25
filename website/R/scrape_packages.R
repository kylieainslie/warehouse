# scrape_packages.R
# Scrape package metadata from R-universe API

library(httr2)
library(jsonlite)
library(dplyr)
library(purrr)

# Configuration
RUNIVERSE_API_BASE <- "https://r-universe.dev/api"

# Define source universes to scrape
# Priority universes get their category assigned; cran is scraped for everything else
PRIORITY_UNIVERSES <- list(
  # Epidemiology & Public Health
  epidemiology = c(
    "epiverse-trace",
    "mrc-ide",
    "reconverse",
    "kylieainslie",
    "cmmid",                    # LSHTM Centre for Mathematical Modelling
    "jameel-institute",         # Jameel Institute
    "epiforecasts",             # Epiforecasts team
    "epinowcast",               # Epinowcast team (nowcasting/forecasting)
    "r-epidemics-consortium",   # RECON
    "covid19r",                 # COVID-19 R packages
    "thinklab"                  # Thinklab
  ),

  # Spatial & Geospatial
  spatial = c(
    "r-spatial",
    "rspatial",
    "paleolimbot"
  ),

  # Statistics & Modeling
  statistics = c(
    "stan-dev",                 # Stan ecosystem
    "paul-buerkner",            # brms author
    "easystats",                # easystats ecosystem
    "vincentarelbundock"        # marginaleffects, modelsummary
  ),

  # Data Science & Tidyverse
  tidyverse = c(
    "tidyverse",
    "r-lib",
    "tidymodels",
    "business-science"
  ),

  # Genomics & Bioinformatics (skip for now - bioc API returns too many duplicates)
  # bioinformatics = c("bioc"),

  # Scientific Computing
  ropensci = c("ropensci"),

  # Shiny & Visualization
  visualization = c(
    "dreamrs",                  # shinyWidgets, esquisse
    "daattali",                 # shinyjs author
    "glin",                     # reactable
    "rstudio"
  ),

  # R Infrastructure
  infrastructure = c(
    "r-forge",
    "r-hub"
  )
)

# Main source for all CRAN packages (R-universe mirror has limited API)
CRAN_UNIVERSE <- "cran"

# Direct CRAN URL for comprehensive package list
CRAN_PACKAGES_URL <- "https://cran.r-project.org/web/packages/packages.rds"

# GitHub organizations to scrape directly (supplements R-universe)
GITHUB_ORGS <- c(
  "seroanalytics",            # serosolver etc
  "HopkinsIDD",               # Johns Hopkins
  "reichlab",                 # Reich Lab forecasting
  "cdcepi",                   # CDC
  "ecdc",                     # European CDC
  "WorldHealthOrganization",  # WHO
  "covid-projections",
  "metrumresearchgroup"       # pharmacometrics
)

# Null coalescing operator
`%||%` <- function(x, y) if (is.null(x) || length(x) == 0) y else x

# ============================================================================
# DISCOVERY-BASED SCRAPING CONFIGURATION
# Topics and keywords for automatic package discovery across all sources
# ============================================================================

# Topics to search across R-universe (searches ALL universes, not just priority ones)
DISCOVERY_TOPICS <- list(
  epidemiology = c("epidemic", "outbreak", "infectious-disease", "disease-modeling",
                   "surveillance", "nowcasting", "forecasting", "serology", "public-health"),
  spatial = c("geospatial", "gis", "spatial-analysis", "mapping", "raster", "vector"),
  statistics = c("bayesian", "causal-inference", "time-series", "survival-analysis", "regression"),
  tidyverse = c("tidyverse", "dplyr", "tidyr", "ggplot2", "data-wrangling"),
  visualization = c("data-visualization", "plotting", "shiny", "interactive", "dashboard"),
  machine_learning = c("machine-learning", "deep-learning", "neural-network", "classification"),
  bioinformatics = c("genomics", "bioinformatics", "sequencing", "proteomics")
)

# Topics to search on GitHub (for packages not on R-universe)
GITHUB_TOPICS <- list(
  epidemiology = c("epidemiology", "infectious-disease", "public-health", "disease-modeling"),
  spatial = c("geospatial", "gis", "spatial-analysis", "r-spatial"),
  statistics = c("bayesian", "statistics", "time-series"),
  tidyverse = c("tidyverse", "rstats", "r-package"),
  visualization = c("shiny", "ggplot2", "data-visualization"),
  machine_learning = c("machine-learning", "r-machine-learning"),
  bioinformatics = c("bioinformatics", "genomics", "rnaseq")
)

# CRAN Task Views to parse for category assignment
CRAN_TASK_VIEWS <- list(
  epidemiology = "Epidemiology",
  spatial = "Spatial",
  statistics = c("Bayesian", "TimeSeries", "Survival", "CausalInference"),
  machine_learning = "MachineLearning",
  visualization = "Graphics",
  bioinformatics = c("Genetics", "Phylogenetics"),
  clinical_trials = "ClinicalTrials"
)

# Keywords for auto-categorizing CRAN packages by content
CATEGORY_KEYWORDS <- list(
  epidemiology = c("epidemic", "outbreak", "infectious", "disease", "incidence",
                   "prevalence", "reproduction number", "serial interval",
                   "contact tracing", "serology", "surveillance", "transmission"),
  spatial = c("spatial", "geospatial", "raster", "shapefile", "coordinates",
              "mapping", "gis", "geometry", "polygon"),
  statistics = c("bayesian", "posterior", "mcmc", "regression", "glm", "mixed model",
                 "survival", "hazard", "time series", "arima", "forecast"),
  tidyverse = c("tidy data", "tibble", "pipe", "dplyr", "tidyr", "ggplot"),
  visualization = c("plot", "chart", "graph", "dashboard", "shiny", "interactive"),
  machine_learning = c("machine learning", "neural", "deep learning", "classification",
                       "clustering", "random forest", "xgboost", "keras", "tensorflow"),
  bioinformatics = c("genome", "sequencing", "gene expression", "protein", "dna", "rna", "variant")
)

#' Fetch all packages directly from CRAN
#' @return A tibble of package metadata
fetch_cran_packages <- function() {
  message("  Fetching all CRAN packages directly...")

  tryCatch({
    # Download CRAN packages database
    temp_file <- tempfile(fileext = ".rds")
    download.file(CRAN_PACKAGES_URL, temp_file, quiet = TRUE)
    cran_db <- readRDS(temp_file)
    unlink(temp_file)

    # Convert matrix to tibble
    cran_df <- as.data.frame(cran_db, stringsAsFactors = FALSE) |>
      as_tibble()

    message(sprintf("    Downloaded %d packages from CRAN", nrow(cran_df)))

    # Transform to our standard format
    result <- cran_df |>
      transmute(
        package_name = Package,
        title = Title,
        description = Description,
        version = Version,
        maintainer = Maintainer,
        author = Author,
        license = License,
        url = URL,
        bug_reports = BugReports,
        repository = sprintf("https://cran.r-project.org/package=%s", Package),
        exports = list(character(0)),
        topics = list(character(0)),
        dependencies = list(list()),
        score = NA_real_,
        stars = NA_integer_,
        registered = as.character(NA),
        source_universe = "cran-direct"
      )

    message(sprintf("  Total: %d packages from CRAN", nrow(result)))
    result

  }, error = function(e) {
    warning(sprintf("Failed to fetch from CRAN: %s", e$message))
    tibble()
  })
}

#' Fetch R packages from a GitHub organization
#' @param org Character. The GitHub organization name
#' @param github_token Character. GitHub personal access token (optional but recommended)
#' @return A tibble of package metadata
fetch_github_org_packages <- function(org, github_token = Sys.getenv("GITHUB_TOKEN")) {
  message(sprintf("  Fetching R packages from GitHub: %s", org))

  # Search for repos with DESCRIPTION file (R packages)
  search_url <- sprintf(
    "https://api.github.com/search/repositories?q=org:%s+language:R+fork:false&per_page=100",
    org
  )

  headers <- list(
    Accept = "application/vnd.github.v3+json",
    `User-Agent` = "TheWarehouse-Scraper"
  )
  if (nchar(github_token) > 0) {
    headers$Authorization <- sprintf("token %s", github_token)
  }

  tryCatch({
    resp <- request(search_url) |>
      req_headers(!!!headers) |>
      req_timeout(30) |>
      req_perform()

    data <- resp |> resp_body_json()

    if (length(data$items) == 0) {
      message(sprintf("    No R packages found in %s", org))
      return(tibble())
    }

    # For each repo, try to fetch DESCRIPTION file
    packages <- map_dfr(data$items, function(repo) {
      desc_url <- sprintf(
        "https://raw.githubusercontent.com/%s/HEAD/DESCRIPTION",
        repo$full_name
      )

      tryCatch({
        desc_resp <- request(desc_url) |>
          req_timeout(10) |>
          req_perform()

        desc_text <- resp_body_string(desc_resp)

        # Parse DESCRIPTION file
        desc_lines <- strsplit(desc_text, "\n")[[1]]
        get_field <- function(field) {
          line <- grep(sprintf("^%s:", field), desc_lines, value = TRUE)[1]
          if (is.na(line)) return(NA_character_)
          trimws(sub(sprintf("^%s:\\s*", field), "", line))
        }

        tibble(
          package_name = get_field("Package"),
          title = get_field("Title"),
          description = get_field("Description"),
          version = get_field("Version"),
          maintainer = get_field("Maintainer"),
          author = get_field("Author"),
          license = get_field("License"),
          url = as.character(repo$html_url),
          bug_reports = sprintf("%s/issues", repo$html_url),
          repository = as.character(repo$html_url),
          exports = list(character(0)),  # Can't easily get exports from GitHub
          topics = list(as.character(repo$topics %||% character(0))),
          dependencies = list(list()),
          score = NA_real_,
          stars = as.integer(repo$stargazers_count %||% 0L),
          registered = as.character(NA),
          source_universe = sprintf("github:%s", org)
        )
      }, error = function(e) {
        # Not an R package or no DESCRIPTION
        tibble()
      })
    })

    # Filter out non-packages (no Package field)
    packages <- packages |> filter(!is.na(package_name))

    message(sprintf("    Found %d R packages in %s", nrow(packages), org))
    packages

  }, error = function(e) {
    warning(sprintf("Failed to fetch from GitHub %s: %s", org, e$message))
    tibble()
  })
}

#' Fetch packages from a specific R-universe with pagination
#' @param universe Character. The universe name (e.g., "epiverse-trace")
#' @param batch_size Integer. Number of packages per request (max 1000)
#' @return A tibble of package metadata
fetch_universe_packages <- function(universe, batch_size = 1000) {
  base_url <- sprintf("https://%s.r-universe.dev/api/packages", universe)

  message(sprintf("  Fetching from %s...", universe))

  all_packages <- list()
  skip <- 0

  tryCatch({
    repeat {
      url <- sprintf("%s?limit=%d&skip=%d", base_url, batch_size, skip)

      resp <- request(url) |>
        req_headers(Accept = "application/json") |>
        req_timeout(60) |>
        req_perform()

      packages <- resp |>
        resp_body_json(simplifyVector = FALSE)

      if (length(packages) == 0) break

      all_packages <- c(all_packages, packages)
      message(sprintf("    Fetched %d packages (total: %d)", length(packages), length(all_packages)))

      if (length(packages) < batch_size) break

      skip <- skip + batch_size
      Sys.sleep(0.5)  # Rate limiting
    }

    if (length(all_packages) == 0) {
      message(sprintf("  No packages found in %s", universe))
      return(tibble())
    }

    # Transform to tibble with key fields
    result <- map_dfr(all_packages, function(pkg) {
      tibble(
        package_name = pkg$Package %||% NA_character_,
        title = pkg$Title %||% NA_character_,
        description = pkg$Description %||% NA_character_,
        version = pkg$Version %||% NA_character_,
        maintainer = pkg$Maintainer %||% NA_character_,
        author = pkg$Author %||% NA_character_,
        license = pkg$License %||% NA_character_,
        url = pkg$URL %||% NA_character_,
        bug_reports = pkg$BugReports %||% NA_character_,
        repository = pkg$`_repo` %||% NA_character_,
        exports = list(pkg$`_exports` %||% character(0)),
        topics = list(pkg$`_topics` %||% character(0)),
        dependencies = list(pkg$`_dependencies` %||% list()),
        score = pkg$`_score` %||% NA_real_,
        stars = pkg$`_stars` %||% 0L,
        registered = pkg$`_registered` %||% NA_character_,
        source_universe = universe
      )
    })

    message(sprintf("  Total: %d packages from %s", nrow(result), universe))
    result

  }, error = function(e) {
    warning(sprintf("Failed to fetch from %s: %s", universe, e$message))
    tibble()
  })
}

#' Search R-universe by topic/keyword
#' @param query Character. The search query
#' @param limit Integer. Maximum results to return
#' @return A tibble of search results
search_packages <- function(query, limit = 100) {
  url <- sprintf("%s/search", RUNIVERSE_API_BASE)

  message(sprintf("Searching for: %s", query))

  tryCatch({
    resp <- request(url) |>
      req_url_query(q = query, limit = limit) |>
      req_headers(Accept = "application/json") |>
      req_timeout(30) |>
      req_perform()

    results <- resp |>
      resp_body_json(simplifyVector = FALSE)

    if (length(results$results) == 0) {
      return(tibble())
    }

    map_dfr(results$results, function(pkg) {
      tibble(
        package_name = pkg$Package %||% NA_character_,
        title = pkg$Title %||% NA_character_,
        description = pkg$Description %||% NA_character_,
        version = pkg$Version %||% NA_character_,
        maintainer_name = pkg$maintainer$name %||% NA_character_,
        maintainer_email = pkg$maintainer$email %||% NA_character_,
        source_user = pkg$`_user` %||% NA_character_,
        stars = pkg$stars %||% 0L,
        score = pkg$`_score` %||% NA_real_,
        topics = list(pkg$`_topics` %||% character(0)),
        exports = list(pkg$`_exports` %||% character(0)),
        match_score = pkg$`_matchscore` %||% NA_real_
      )
    })

  }, error = function(e) {
    warning(sprintf("Search failed for '%s': %s", query, e$message))
    tibble()
  })
}

# ============================================================================
# DISCOVERY FUNCTIONS
# Functions to discover packages from various sources using topic-based search
# ============================================================================

#' Fetch packages by topic from R-universe global search
#' @param topic Character. The topic to search for
#' @param limit Integer. Maximum results per search
#' @return A tibble of package metadata
fetch_packages_by_topic <- function(topic, limit = 200) {
  url <- sprintf("%s/search", RUNIVERSE_API_BASE)

  message(sprintf("    Searching topic: %s", topic))


  tryCatch({
    resp <- request(url) |>
      req_url_query(q = sprintf("topic:%s", topic), limit = limit) |>
      req_headers(Accept = "application/json") |>
      req_timeout(30) |>
      req_perform()

    results <- resp |>
      resp_body_json(simplifyVector = FALSE)

    if (length(results$results) == 0) {
      return(tibble())
    }

    # Transform to standard format
    map_dfr(results$results, function(pkg) {
      tibble(
        package_name = pkg$Package %||% NA_character_,
        title = pkg$Title %||% NA_character_,
        description = pkg$Description %||% NA_character_,
        version = pkg$Version %||% NA_character_,
        maintainer = pkg$Maintainer %||% NA_character_,
        author = pkg$Author %||% NA_character_,
        license = pkg$License %||% NA_character_,
        url = pkg$URL %||% NA_character_,
        bug_reports = pkg$BugReports %||% NA_character_,
        repository = NA_character_,
        exports = list(pkg$`_exports` %||% character(0)),
        topics = list(pkg$`_topics` %||% character(0)),
        dependencies = list(list()),
        score = pkg$`_score` %||% NA_real_,
        stars = pkg$`_stars` %||% 0L,
        registered = NA_character_,
        source_universe = pkg$`_user` %||% "topic-search"
      )
    })

  }, error = function(e) {
    warning(sprintf("Topic search failed for '%s': %s", topic, e$message))
    tibble()
  })
}

#' Fetch packages from GitHub by topic
#' @param topic Character. The GitHub topic to search
#' @param github_token Character. GitHub token for authentication
#' @param limit Integer. Max results to return
#' @return A tibble of package metadata
fetch_github_topic_packages <- function(topic, github_token = Sys.getenv("GITHUB_TOKEN"), limit = 100) {
  message(sprintf("    Searching GitHub topic: %s", topic))

  search_url <- sprintf(
    "https://api.github.com/search/repositories?q=topic:%s+language:R+fork:false&per_page=%d&sort=stars",
    topic, min(limit, 100)
  )

  headers <- list(
    Accept = "application/vnd.github.v3+json",
    `User-Agent` = "TheWarehouse-Scraper"
  )
  if (nchar(github_token) > 0) {
    headers$Authorization <- sprintf("token %s", github_token)
  }

  tryCatch({
    resp <- request(search_url) |>
      req_headers(!!!headers) |>
      req_timeout(30) |>
      req_perform()

    data <- resp |> resp_body_json()

    if (length(data$items) == 0) {
      return(tibble())
    }

    # For each repo, try to fetch DESCRIPTION file
    packages <- map_dfr(data$items, function(repo) {
      desc_url <- sprintf(
        "https://raw.githubusercontent.com/%s/HEAD/DESCRIPTION",
        repo$full_name
      )

      tryCatch({
        desc_resp <- request(desc_url) |>
          req_timeout(10) |>
          req_perform()

        desc_text <- resp_body_string(desc_resp)

        # Parse DESCRIPTION file
        desc_lines <- strsplit(desc_text, "\n")[[1]]
        get_field <- function(field) {
          line <- grep(sprintf("^%s:", field), desc_lines, value = TRUE)[1]
          if (is.na(line)) return(NA_character_)
          trimws(sub(sprintf("^%s:\\s*", field), "", line))
        }

        tibble(
          package_name = get_field("Package"),
          title = get_field("Title"),
          description = get_field("Description"),
          version = get_field("Version"),
          maintainer = get_field("Maintainer"),
          author = get_field("Author"),
          license = get_field("License"),
          url = as.character(repo$html_url),
          bug_reports = sprintf("%s/issues", repo$html_url),
          repository = as.character(repo$html_url),
          exports = list(character(0)),
          topics = list(as.character(repo$topics %||% character(0))),
          dependencies = list(list()),
          score = NA_real_,
          stars = as.integer(repo$stargazers_count %||% 0L),
          registered = NA_character_,
          source_universe = sprintf("github-topic:%s", topic)
        )
      }, error = function(e) {
        # Not an R package or no DESCRIPTION
        tibble()
      })
    })

    # Filter out non-packages (no Package field)
    packages |> filter(!is.na(package_name))

  }, error = function(e) {
    warning(sprintf("GitHub topic search failed for '%s': %s", topic, e$message))
    tibble()
  })
}

#' Fetch package names from a CRAN Task View
#' @param view_name Character. The task view name (e.g., "Epidemiology")
#' @return Character vector of package names
fetch_cran_task_view_packages <- function(view_name) {
  url <- sprintf("https://cran.r-project.org/web/views/%s.html", view_name)

  message(sprintf("    Fetching Task View: %s", view_name))

  tryCatch({
    resp <- request(url) |>
      req_timeout(30) |>
      req_perform()

    html <- resp_body_string(resp)

    # Extract package names from links like <a href="../packages/pkgname/index.html">
    matches <- gregexpr('href="../packages/([^/]+)/index.html"', html, perl = TRUE)
    pkg_names <- regmatches(html, matches)[[1]]

    # Extract just the package names
    pkg_names <- gsub('href="../packages/([^/]+)/index.html"', '\\1', pkg_names)

    message(sprintf("      Found %d packages in %s", length(pkg_names), view_name))
    unique(pkg_names)

  }, error = function(e) {
    warning(sprintf("Failed to fetch Task View %s: %s", view_name, e$message))
    character(0)
  })
}

#' Fetch all Bioconductor packages
#' @param version Character. Bioconductor version (default: current)
#' @return A tibble of package metadata
fetch_bioconductor_packages <- function(version = "3.20") {
  url <- sprintf("https://bioconductor.org/packages/json/%s/bioc/packages.json", version)

  message(sprintf("  Fetching Bioconductor packages (version %s)...", version))

  tryCatch({
    resp <- request(url) |>
      req_headers(Accept = "application/json") |>
      req_timeout(120) |>
      req_perform()

    packages <- resp |> resp_body_json()

    message(sprintf("    Downloaded %d packages from Bioconductor", length(packages)))

    # Transform to standard format
    result <- map_dfr(names(packages), function(pkg_name) {
      pkg <- packages[[pkg_name]]
      tibble(
        package_name = pkg_name,
        title = pkg$Title %||% NA_character_,
        description = pkg$Description %||% NA_character_,
        version = pkg$Version %||% NA_character_,
        maintainer = pkg$Maintainer %||% NA_character_,
        author = pkg$Author %||% NA_character_,
        license = pkg$License %||% NA_character_,
        url = pkg$URL %||% NA_character_,
        bug_reports = pkg$BugReports %||% NA_character_,
        repository = sprintf("https://bioconductor.org/packages/%s", pkg_name),
        exports = list(character(0)),
        topics = list(character(0)),
        dependencies = list(list()),
        score = NA_real_,
        stars = NA_integer_,
        registered = NA_character_,
        source_universe = "bioconductor"
      )
    })

    message(sprintf("  Total: %d packages from Bioconductor", nrow(result)))
    result

  }, error = function(e) {
    warning(sprintf("Failed to fetch Bioconductor: %s", e$message))
    tibble()
  })
}

#' Categorize packages by keyword matching in title/description
#' @param packages A tibble of packages with title and description columns
#' @return The packages tibble with updated primary_category
categorize_by_keywords <- function(packages) {
  message("  Applying keyword-based categorization...")

  packages |>
    mutate(
      # Combine title and description for searching (lowercase)
      search_text = tolower(paste(
        coalesce(title, ""),
        coalesce(description, ""),
        sep = " "
      )),
      # Check each category's keywords
      primary_category = case_when(
        # Only re-categorize packages that are currently "general"
        primary_category != "general" ~ primary_category,
        # Check for epidemiology keywords
        grepl(paste(CATEGORY_KEYWORDS$epidemiology, collapse = "|"), search_text, ignore.case = TRUE) ~ "epidemiology",
        # Check for bioinformatics keywords
        grepl(paste(CATEGORY_KEYWORDS$bioinformatics, collapse = "|"), search_text, ignore.case = TRUE) ~ "bioinformatics",
        # Check for spatial keywords
        grepl(paste(CATEGORY_KEYWORDS$spatial, collapse = "|"), search_text, ignore.case = TRUE) ~ "spatial",
        # Check for machine learning keywords
        grepl(paste(CATEGORY_KEYWORDS$machine_learning, collapse = "|"), search_text, ignore.case = TRUE) ~ "machine_learning",
        # Check for statistics keywords
        grepl(paste(CATEGORY_KEYWORDS$statistics, collapse = "|"), search_text, ignore.case = TRUE) ~ "statistics",
        # Check for visualization keywords
        grepl(paste(CATEGORY_KEYWORDS$visualization, collapse = "|"), search_text, ignore.case = TRUE) ~ "visualization",
        # Check for tidyverse keywords
        grepl(paste(CATEGORY_KEYWORDS$tidyverse, collapse = "|"), search_text, ignore.case = TRUE) ~ "tidyverse",
        # Default: keep as general
        TRUE ~ "general"
      )
    ) |>
    select(-search_text)
}

#' Scrape packages from all configured sources
#' @param include_cran Logical. Whether to include all CRAN packages (adds ~23k packages)
#' @param include_github Logical. Whether to scrape GitHub organizations directly
#' @param include_discovery Logical. Whether to use topic-based discovery
#' @param include_bioconductor Logical. Whether to include Bioconductor packages
#' @return A tibble with all scraped packages
scrape_all_sources <- function(include_cran = TRUE, include_github = TRUE,
                               include_discovery = TRUE, include_bioconductor = TRUE) {
  message("Starting comprehensive package scraping...")
  message("Sources: R-universe + Topic Discovery + GitHub + Bioconductor + CRAN")

  all_packages <- tibble()
  scraped_package_names <- character()
  task_view_packages <- list()  # Track packages from task views for category assignment

  # ========================================
  # Phase 1: Priority R-universe universes
  # ========================================
  message("\n=== Phase 1: Priority R-universe universes ===")
  for (category in names(PRIORITY_UNIVERSES)) {
    message(sprintf("\nCategory: %s", category))

    for (universe in PRIORITY_UNIVERSES[[category]]) {
      pkgs <- fetch_universe_packages(universe)

      if (nrow(pkgs) > 0) {
        pkgs$primary_category <- category
        all_packages <- bind_rows(all_packages, pkgs)
        scraped_package_names <- c(scraped_package_names, pkgs$package_name)
      }

      Sys.sleep(1)  # Rate limiting
    }
  }

  message(sprintf("\nPhase 1 complete: %d packages from priority universes", nrow(all_packages)))

  # ========================================
  # Phase 2: R-universe topic-based discovery (NEW)
  # ========================================
  if (include_discovery) {
    message("\n=== Phase 2: R-universe topic-based discovery ===")

    for (category in names(DISCOVERY_TOPICS)) {
      message(sprintf("\n  Category: %s", category))

      for (topic in DISCOVERY_TOPICS[[category]]) {
        pkgs <- fetch_packages_by_topic(topic)

        if (nrow(pkgs) > 0) {
          # Only add packages not already scraped
          new_pkgs <- pkgs |>
            filter(!package_name %in% scraped_package_names)

          if (nrow(new_pkgs) > 0) {
            new_pkgs$primary_category <- category
            new_pkgs <- new_pkgs |> mutate(registered = as.character(registered))
            all_packages <- all_packages |> mutate(registered = as.character(registered))
            all_packages <- bind_rows(all_packages, new_pkgs)
            scraped_package_names <- c(scraped_package_names, new_pkgs$package_name)
            message(sprintf("      Added %d new packages", nrow(new_pkgs)))
          }
        }

        Sys.sleep(0.5)  # Rate limiting
      }
    }

    message(sprintf("\nPhase 2 complete: %d total packages", nrow(all_packages)))
  }

  # ========================================
  # Phase 3: GitHub topic-based discovery (NEW)
  # ========================================
  if (include_github && include_discovery) {
    message("\n=== Phase 3: GitHub topic-based discovery ===")

    for (category in names(GITHUB_TOPICS)) {
      message(sprintf("\n  Category: %s", category))

      for (topic in GITHUB_TOPICS[[category]]) {
        pkgs <- fetch_github_topic_packages(topic)

        if (nrow(pkgs) > 0) {
          # Only add packages not already scraped
          new_pkgs <- pkgs |>
            filter(!package_name %in% scraped_package_names)

          if (nrow(new_pkgs) > 0) {
            new_pkgs$primary_category <- category
            new_pkgs <- new_pkgs |> mutate(registered = as.character(registered))
            all_packages <- all_packages |> mutate(registered = as.character(registered))
            all_packages <- bind_rows(all_packages, new_pkgs)
            scraped_package_names <- c(scraped_package_names, new_pkgs$package_name)
            message(sprintf("      Added %d new packages", nrow(new_pkgs)))
          }
        }

        Sys.sleep(2)  # Conservative rate limiting for GitHub
      }
    }

    message(sprintf("\nPhase 3 complete: %d total packages", nrow(all_packages)))
  }

  # ========================================
  # Phase 4: GitHub organizations (existing)
  # ========================================
  if (include_github && length(GITHUB_ORGS) > 0) {
    message("\n=== Phase 4: GitHub organizations ===")

    for (org in GITHUB_ORGS) {
      pkgs <- fetch_github_org_packages(org)

      if (nrow(pkgs) > 0) {
        # Assign category based on org
        pkgs$primary_category <- case_when(
          org %in% c("seroanalytics", "HopkinsIDD", "reichlab", "cdcepi", "ecdc",
                     "WorldHealthOrganization", "covid-projections") ~ "epidemiology",
          org %in% c("metrumresearchgroup") ~ "pharmacometrics",
          TRUE ~ "github"
        )

        # Only add packages not already scraped
        new_pkgs <- pkgs |>
          filter(!package_name %in% scraped_package_names) |>
          mutate(registered = as.character(registered))

        if (nrow(new_pkgs) > 0) {
          all_packages <- all_packages |>
            mutate(registered = as.character(registered))
          all_packages <- bind_rows(all_packages, new_pkgs)
          scraped_package_names <- c(scraped_package_names, new_pkgs$package_name)
        }
      }

      Sys.sleep(2)  # More conservative rate limiting for GitHub
    }

    message(sprintf("\nPhase 4 complete: %d total packages", nrow(all_packages)))
  }

  # ========================================
  # Phase 5: CRAN Task Views (NEW)
  # ========================================
  if (include_discovery) {
    message("\n=== Phase 5: CRAN Task Views ===")

    for (category in names(CRAN_TASK_VIEWS)) {
      views <- CRAN_TASK_VIEWS[[category]]

      for (view in views) {
        pkg_names <- fetch_cran_task_view_packages(view)
        if (length(pkg_names) > 0) {
          task_view_packages[[category]] <- c(task_view_packages[[category]], pkg_names)
        }
        Sys.sleep(0.5)
      }
    }

    # Deduplicate task view packages
    task_view_packages <- lapply(task_view_packages, unique)
    message(sprintf("\nPhase 5 complete: Found %d packages in task views",
                    sum(sapply(task_view_packages, length))))
  }

  # ========================================
  # Phase 6: Bioconductor (NEW)
  # ========================================
  if (include_bioconductor) {
    message("\n=== Phase 6: Bioconductor ===")
    bioc_pkgs <- fetch_bioconductor_packages()

    if (nrow(bioc_pkgs) > 0) {
      bioc_pkgs$primary_category <- "bioinformatics"

      # Only add packages not already scraped
      new_bioc <- bioc_pkgs |>
        filter(!package_name %in% scraped_package_names) |>
        mutate(
          registered = as.character(registered),
          stars = as.integer(stars)
        )

      if (nrow(new_bioc) > 0) {
        message(sprintf("  Adding %d new packages from Bioconductor", nrow(new_bioc)))
        all_packages <- all_packages |>
          mutate(
            registered = as.character(registered),
            stars = as.integer(stars)
          )
        all_packages <- bind_rows(all_packages, new_bioc)
        scraped_package_names <- c(scraped_package_names, new_bioc$package_name)
      }
    }

    message(sprintf("\nPhase 6 complete: %d total packages", nrow(all_packages)))
  }

  # ========================================
  # Phase 7: CRAN direct (comprehensive coverage)
  # ========================================
  if (include_cran) {
    message("\n=== Phase 7: CRAN direct (comprehensive coverage) ===")
    cran_pkgs <- fetch_cran_packages()

    if (nrow(cran_pkgs) > 0) {
      # Mark CRAN packages that aren't in priority sources
      cran_pkgs$primary_category <- "general"

      # Apply task view categorization to CRAN packages
      if (length(task_view_packages) > 0) {
        for (category in names(task_view_packages)) {
          pkg_names <- task_view_packages[[category]]
          cran_pkgs <- cran_pkgs |>
            mutate(
              primary_category = ifelse(
                package_name %in% pkg_names & primary_category == "general",
                category,
                primary_category
              )
            )
        }
      }

      # Only add packages not already scraped
      new_cran <- cran_pkgs |>
        filter(!package_name %in% scraped_package_names) |>
        mutate(
          registered = as.character(registered),
          stars = as.integer(stars)
        )

      message(sprintf("  Adding %d new packages from CRAN", nrow(new_cran)))
      all_packages <- all_packages |>
        mutate(
          registered = as.character(registered),
          stars = as.integer(stars)
        )
      all_packages <- bind_rows(all_packages, new_cran)
    }
  }

  # ========================================
  # Phase 8: Keyword-based categorization (NEW)
  # ========================================
  message("\n=== Phase 8: Keyword-based categorization ===")
  all_packages <- categorize_by_keywords(all_packages)

  # Count re-categorized packages
  recategorized <- sum(all_packages$primary_category != "general")
  message(sprintf("  %d packages now have specific categories", recategorized))

  # ========================================
  # Final deduplication
  # ========================================
  all_packages <- all_packages |>
    filter(!is.na(package_name)) |>
    group_by(package_name) |>
    slice_max(order_by = coalesce(score, 0), n = 1, with_ties = FALSE) |>
    ungroup()

  message(sprintf("\n=== COMPLETE: %d unique packages scraped ===", nrow(all_packages)))
  all_packages
}

# Keep old function name for backwards compatibility
scrape_all_universes <- scrape_all_sources

#' Search for packages by topic keywords
#' @param topics Character vector of topics to search
#' @return A tibble of packages matching topics
scrape_by_topics <- function(topics) {
  message("Searching by topics...")

  all_results <- tibble()

  for (topic in topics) {
    results <- search_packages(sprintf("topic:%s", topic), limit = 50)

    if (nrow(results) > 0) {
      results$search_topic <- topic
      all_results <- bind_rows(all_results, results)
    }

    Sys.sleep(1)
  }

  # Deduplicate
  all_results |>
    filter(!is.na(package_name)) |>
    group_by(package_name) |>
    slice_max(order_by = coalesce(score, 0), n = 1, with_ties = FALSE) |>
    ungroup()
}

#' Main function to run the full scrape
#' @param output_path Path to save the scraped data (RDS file)
#' @return The scraped packages tibble
run_scrape <- function(output_path = file.path(getwd(), "data", "scraped_packages.rds")) {
  # Scrape from configured universes
  packages <- scrape_all_universes()

  # Add timestamp

packages$scraped_at <- Sys.time()

  # Save to file
  dir.create(dirname(output_path), showWarnings = FALSE, recursive = TRUE)
  saveRDS(packages, output_path)
  message(sprintf("Saved %d packages to %s", nrow(packages), output_path))

  invisible(packages)
}

# Run if called directly
if (sys.nframe() == 0) {
  run_scrape()
}
