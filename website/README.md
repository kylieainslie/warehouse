# The Warehouse

**Find R packages by what they do, not what they're called.**

[thewarehouse-pkg.netlify.app](https://thewarehouse-pkg.netlify.app/)

## What is this?

The Warehouse is a search engine for R packages focused on functionality. Instead of searching by package name, search by task: "estimate serial interval", "create interactive plots", "read Excel files".

**23,000+ packages** indexed from CRAN, R-universe, and GitHub.

## Features

- **Functionality-first search** — Find packages by what you want to do
- **AI assistant** — Ask questions like "What package should I use for epidemic curves?"
- **Curated categories** — Epidemiology, Tidyverse, Visualization, Spatial, Statistics, and more
- **Quality signals** — R-universe scores, GitHub stars, and package metadata

## Data Sources

| Source | Packages | Description |
|--------|----------|-------------|
| CRAN | ~23,000 | All CRAN packages via direct scraping |
| R-universe | ~1,000 | Priority universes: epiverse-trace, mrc-ide, tidyverse, ropensci, etc. |
| GitHub | ~70 | Direct scraping of orgs not on R-universe (seroanalytics, HopkinsIDD, WHO, CDC) |

## Tech Stack

- **Frontend**: Quarto static site
- **Search**: Fuse.js (client-side fuzzy search with BM25-style field weighting)
- **AI Chat**: Claude API via Netlify Functions
- **Data**: SQLite database, JSON exports
- **Hosting**: Netlify

## Local Development

```bash
# Install dependencies
cd website
Rscript -e "install.packages(c('httr2', 'jsonlite', 'dplyr', 'DBI', 'RSQLite'))"

# Scrape packages (takes ~5 minutes)
Rscript -e "source('R/scrape_packages.R'); run_scrape()"

# Build database and export JSON
Rscript -e "source('R/build_database.R'); build_database()"
Rscript -e "source('R/export_json.R'); export_all()"

# Preview site
quarto preview
```

## Project Structure

```
website/
├── R/
│   ├── scrape_packages.R    # Fetch from CRAN, R-universe, GitHub
│   ├── build_database.R     # SQLite schema and population
│   └── export_json.R        # Generate JSON for client-side search
├── js/
│   ├── search.js            # Fuse.js search implementation
│   ├── chatbot.js           # AI assistant UI
│   └── feedback.js          # User feedback system
├── netlify/
│   └── functions/
│       └── chat.js          # Claude API proxy
├── data/
│   ├── packages.json        # Full package index (~40MB)
│   └── categories/          # Category-specific JSON files
├── categories/              # Category browse pages
├── index.qmd                # Homepage
└── styles.css               # Custom styles
```

## Contributing

- **Add a package source**: Edit `R/scrape_packages.R` to add R-universe universes or GitHub organizations
- **Improve search**: Modify field weights in `js/search.js`
- **Add categories**: Create new `.qmd` files in `categories/`

## License

MIT
