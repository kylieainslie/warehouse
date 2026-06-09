# The Warehouse

**Function-first R package discovery**

Find R packages by what they do, not what they're called.

**Live site:** [rwarehouse.netlify.app](https://rwarehouse.netlify.app)

## Features

- **Semantic search** - Describe what you want to do, find relevant packages
- **23,000+ packages** - CRAN, Bioconductor, and GitHub packages indexed
- **AI-powered search** - Uses Claude for intelligent query understanding
- **Quality scores** - R-Universe quality metrics for every package
- **Browse by category** - Epidemiology, machine learning, visualization, AI/LLMs, and more
- **Community reviews** - Share experiences and tips for packages

## How It Works

![The Warehouse — How It Works](architecture.png)

The Warehouse is built around a weekly automated pipeline and a static website, with AI used at two points in the process.

**Data pipeline (weekly, automated)**
A GitHub Actions workflow runs every week and scrapes package metadata from the [R-Universe API](https://r-universe.dev), which indexes packages from CRAN, Bioconductor, and GitHub. Metadata — name, title, description, topics, quality scores, and author information — is stored in a local SQLite database. Community-submitted packages and user reviews (collected via Google Sheets) are merged in at this stage. Claude then reads each package description and automatically assigns it to one or more categories (e.g. *epidemiology*, *spatial analysis*, *machine learning*). Finally, everything is exported to a flat JSON file that the website reads directly.

**Website**
The site is a static [Quarto](https://quarto.org) site hosted on Netlify. Because the full package index is exported as a JSON file and loaded in the browser, basic search works instantly without any server round-trip. The site also has a Discover section that surfaces hidden gems (high-quality packages with low download counts) and packages featured in [R Weekly](https://rweekly.org).

**AI**
Claude is used in two places: during the pipeline to auto-label packages with categories, and at search time to expand queries and power the chatbot. See the [Search Strategy](#search-strategy) section for details on how search works.

## Search Strategy

![The Warehouse — Search Strategy](search-strategy.png)

Every search is handled by a Netlify serverless function that combines Claude with a BM25 ranking engine.

**1. Query expansion via Claude**
The raw query is sent to Claude, which returns two things: a list of R packages likely to match, and a set of related search terms (synonyms, method names, related concepts). For example, "fit a mixed model" might expand to terms like *random effects*, *lme4*, *repeated measures*, and *REML*.

**2. BM25 search**
The original query and Claude's expanded terms are run through a BM25 scoring engine over the full package index. BM25 (Best Match 25) is a standard information retrieval algorithm that ranks documents by term frequency — how often a search term appears — while penalising two things that naive term-counting gets wrong: (1) diminishing returns from repeated terms (finding a word 20 times isn't 20× better than finding it twice), and (2) long documents that mention a term incidentally. Fields are weighted so a match in the package name counts far more than a match in the description.

**3. Merge**
Claude's suggested packages are placed first in the results (verified against the database), followed by the BM25-ranked matches. This means well-known packages Claude directly identifies appear at the top, while the BM25 search catches relevant packages Claude may not have named explicitly.

**Shortcuts and fallbacks**
If the query exactly matches a package name, Claude is skipped and the result is returned immediately. If the API call fails or times out, the client falls back to a local [Fuse.js](https://fusejs.io) fuzzy search over the same package data.

## Tech Stack

- **Frontend:** [Quarto](https://quarto.org) static site
- **Search:** [Fuse.js](https://fusejs.io) (client-side) + Claude API (query expansion)
- **AI:** Claude (auto-tagging + chatbot recommendations)
- **Data pipeline:** R (httr2, dplyr, DBI, RSQLite) + GitHub Actions
- **Database:** SQLite
- **Hosting:** Netlify (with serverless functions)

## Local Development

### Prerequisites

- [Quarto](https://quarto.org/docs/get-started/)
- [Node.js](https://nodejs.org/) 18+
- R with packages: `httr2`, `jsonlite`, `dplyr`, `purrr`, `DBI`, `RSQLite`, `tibble`, `stringr`

### Setup

```bash
# Clone repository
git clone https://github.com/kylieainslie/warehouse.git
cd warehouse/website

# Install function dependencies
cd netlify/functions && npm install && cd ../..

# Preview website
quarto preview
```

### Environment Variables

For AI features to work locally, set in Netlify dashboard or `.env`:

```
ANTHROPIC_API_KEY=your_key_here
```

## Project Structure

```
warehouse/
├── website/
│   ├── _quarto.yml           # Site config
│   ├── index.qmd             # Homepage
│   ├── categories/           # One page per package category
│   ├── R/                    # Data pipeline scripts
│   │   ├── scrape_packages.R
│   │   ├── build_database.R
│   │   ├── export_json.R
│   │   └── fetch_discover.R
│   ├── scripts/              # Utility scripts (reviews, tagging)
│   ├── data/                 # SQLite database + exported JSON
│   ├── js/                   # Client-side JS (search, chatbot, discover)
│   ├── netlify/functions/    # Serverless API (search, chat, reviews)
│   ├── tests/                # R (testthat) and JS (Jest) tests
│   └── styles.css
└── README.md
```

## Contributing

Contributions welcome! You can:

- **Submit packages** - [Add a package](https://rwarehouse.netlify.app/submit.html)
- **Write reviews** - [Share your experience](https://rwarehouse.netlify.app/submit-review.html)
- **Report issues** - [GitHub Issues](https://github.com/kylieainslie/warehouse/issues)
- **Contribute code** - PRs welcome

## License

MIT License

## Credits

- Data from [R-Universe](https://r-universe.dev), [CRAN](https://cran.r-project.org), [Bioconductor](https://bioconductor.org)
- Built with [Quarto](https://quarto.org) and [Claude Code](https://claude.ai/code)
