# The Warehouse news

The Warehouse is a website, not a package, so versions are dates
(`YEAR.MONTH`) and are only tagged for notable changes. Weekly data
refreshes and dependency updates are not listed.

## Development version

* Package cards and pages now show when a package was last released on
  CRAN, its monthly downloads, and how many CRAN packages depend on it.
  Packages with no release in over two years are flagged. GitHub stars are
  only shown when a package has some, so CRAN packages no longer show
  "0 stars".

## v2026.10 — Discovery redesign (October 2026)

* **Hidden Gems** replaces the Trending, New and Rising Stars tabs in the
  Discover section. It highlights well-made packages that few people know
  about, ranked by R-universe quality score relative to GitHub stars or
  reverse dependencies, whichever is larger.
* **You might also like** now appears under search results, suggesting
  packages that share topics or a category with your results.
* Packages are now **auto-tagged** with topics from a fixed list using
  Claude Haiku 5.5, which improves search and recommendations for packages
  with few or no topics of their own. GitHub topics that were previously
  being dropped are now included.
* Fixed the Discover section, which had stopped updating in January 2026
  after R-universe retired the API it relied on.
* Fixed discover cards growing wider when a description contains a long URL.

## Updates since launch (January – September 2026)

### Search

* AI search now combines Claude's suggestions with a database search,
  using real package data, and falls back to a local search if the AI is
  unavailable (January).
* Local search ranking uses BM25, with stemming, abbreviation expansion
  and matching on hyphenated topics (January – February).
* Search results show more packages, with a "Show more" button
  (January).
* Fixed false-positive matches on package names and broadened search
  vocabulary (May).

### Site

* New **AI & LLMs** category, category suggestions, and search on the
  Browse page (January).
* Improved mobile layout, and fixed long package names overflowing cards
  (January, July).
* About page now explains how the site works and how search finds
  packages (June).
* Added a **Claude skill** for finding R packages from Claude (March).

### Security and reliability

* Review submissions are sanitised, the site's server functions are
  rate-limited, and several security issues in them were fixed
  (January – February).
* Claude models and Node.js are now checked and updated automatically
  each month (May).
* Added automated tests for the data pipeline and server functions
  (January).

## v2025.12 — Launch (December 2025)

The first public version of The Warehouse, a place to find R packages by
describing what you want to do.

* **Search** across 23,000+ packages from CRAN, Bioconductor, R-universe
  and GitHub, with AI-assisted results and an **Ask AI** chat assistant.
* **Browse** packages by category and subcategory, with curated
  collections such as Pharmaverse.
* **Discover** section on the home page with trending, new and rising
  packages, plus highlights from R Weekly.
* **Package pages** with details, links and community reviews.
* **Reviews**: anyone can review a package via a short form.
* **Submit a package** through a GitHub issue, added automatically.
* Package data is refreshed automatically by scheduled GitHub Actions.
