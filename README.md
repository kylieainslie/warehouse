# The Warehouse

**Function-first R package discovery**

Find R packages by what they do, not what they're called.

## 🚀 Quick Start

### Prerequisites

```r
# Install required packages
install.packages(c(
  "tidyverse",
  "DBI",
  "RSQLite",
  "httr",
  "jsonlite",
  "rvest",
  "gh",
  "quarto"
))
```

### Setup

```bash
# Clone repository
git clone https://github.com/YOUR_USERNAME/warehouse.git
cd warehouse

# Open in RStudio
open warehouse.Rproj

# Preview website
cd website
quarto preview
```

## 📁 Project Structure

```
warehouse/
├── data/
│   ├── raw/              # Scraped data
│   ├── processed/        # Cleaned data
│   └── warehouse.db      # SQLite database (will be created)
├── scripts/
│   ├── 01_scrape_cran.R
│   ├── 02_scrape_github.R
│   └── ...
├── website/
│   ├── _quarto.yml       # Website config
│   ├── index.qmd         # Homepage
│   ├── categories/       # Category pages
│   └── styles.css        # Custom CSS
├── warehouse.Rproj       # RStudio project
└── README.md
```

## 🛠️ Development Roadmap

### Phase 1: Data Collection (Week 1)
- [ ] Scrape CRAN packages
- [ ] Scrape GitHub packages
- [ ] Calculate quality scores
- [ ] Auto-categorize packages

### Phase 2: Website (Week 2)
- [x] Basic website structure
- [x] Homepage with search
- [x] Category pages
- [x] Submission form
- [ ] Search functionality
- [ ] Package detail pages

### Phase 3: Features (Week 3)
- [ ] Review system
- [ ] Database integration
- [ ] Auto-updates
- [ ] Deployment

## 🔍 How It Works

1. **Data Collection:** Scrape CRAN, GitHub, Bioconductor
2. **Quality Scoring:** Calculate 0-100 scores based on tests, docs, maintenance
3. **Categorization:** Organize by function (epidemiology, data manipulation, etc.)
4. **Search:** Function-first search across all metadata
5. **Reviews:** Community feedback system

## 🎯 Goals

- Make R package discovery easier
- Highlight quality packages regardless of source
- Enable function-first search ("estimate serial interval")
- Build community knowledge through reviews
- Extend to Python/Julia if successful

## 📝 License

MIT License - see LICENSE file

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📧 Contact

- GitHub Issues: [Report bugs or request features](https://github.com/YOUR_USERNAME/warehouse/issues)
- Email: your.email@example.com

---

*Built with [Quarto](https://quarto.org) and ❤️*
