// search.js
// Client-side fuzzy search using Fuse.js

let searchIndex = null;
let fuse = null;
let isSearchReady = false;
let reviewStats = {}; // Package review statistics from Google Reviews-style system

// Track last search for AI comparison feature
let lastSearchResults = [];
let lastSearchQuery = '';

// Category metadata for suggestions
let categoriesData = null;

// Keywords that map to specific categories (for better matching)
const categoryKeywords = {
  'ai': ['llm', 'llms', 'large language model', 'chatgpt', 'openai', 'claude', 'gemini', 'gpt', 'chatbot', 'generative ai', 'artificial intelligence', 'ollama', 'prompt', 'chat with ai'],
  'data-wrangling': ['table', 'tables', 'data frame', 'dataframe', 'data.table', 'tidytable', 'wrangle', 'reshape', 'pivot', 'join', 'merge'],
  'epidemiology': ['serial interval', 'reproduction number', 'outbreak', 'epidemic', 'pandemic', 'incidence', 'prevalence', 'transmission', 'infectious', 'disease', 'surveillance', 'contact tracing', 'r0', 'rt'],
  'epiverse-trace': ['serial interval', 'reproduction number', 'outbreak', 'epidemic', 'epiestim', 'epinow', 'cfr', 'case fatality'],
  'genomics': ['dna', 'rna', 'sequence', 'gene', 'genome', 'mutation', 'variant', 'expression', 'sequencing'],
  'bioinformatics': ['dna', 'rna', 'protein', 'sequence', 'alignment', 'blast', 'fasta', 'phylogenetic'],
  'visualization': ['plot', 'chart', 'graph', 'visualize', 'ggplot', 'dashboard', 'graphics'],
  'machine-learning': ['predict', 'classify', 'cluster', 'neural', 'deep learning', 'model', 'training'],
  'time-series': ['forecast', 'time series', 'temporal', 'trend', 'seasonal', 'arima'],
  'spatial-analysis': ['spatial', 'geographic', 'gis', 'coordinate', 'polygon', 'raster'],
  'pharmacometrics': ['pk', 'pd', 'pharmacokinetic', 'pharmacodynamic', 'dosing', 'drug', 'concentration'],
  'clinical-trials': ['clinical trial', 'randomized', 'placebo', 'endpoint', 'survival analysis'],
  'statistics': ['regression', 'hypothesis', 'bayesian', 'inference', 'p-value', 'confidence interval'],
  'shiny': ['interactive', 'web app', 'dashboard', 'reactive', 'ui']
};

// Query expansion: map abbreviations and plurals to full terms for better matching
const queryExpansions = {
  // AI/ML
  'llm': 'large language model chatgpt openai',
  'llms': 'large language models chatgpt openai',
  'ml': 'machine learning predictive classification',
  'ai': 'artificial intelligence machine learning',
  'dl': 'deep learning neural network torch keras',
  'nn': 'neural network deep learning',
  'nlp': 'natural language processing text mining',
  'cv': 'cross validation resampling',
  'rf': 'random forest randomforest ranger',
  'xgb': 'xgboost gradient boosting',
  'svm': 'support vector machine',
  'pca': 'principal component analysis dimensionality',
  'kmeans': 'k-means clustering cluster',

  // Statistics
  'ols': 'ordinary least squares linear regression',
  'gee': 'generalized estimating equations geepack clustered data sandwich cluster-robust marginal model longitudinal',
  'glm': 'generalized linear model logistic poisson',
  'gam': 'generalized additive model spline mgcv',
  'lmm': 'linear mixed model mixed effects lme4',
  'glmm': 'generalized linear mixed model mixed effects',
  'anova': 'analysis of variance aov',
  'sem': 'structural equation modeling lavaan',
  'irt': 'item response theory psychometric',
  'cfa': 'confirmatory factor analysis lavaan',
  'efa': 'exploratory factor analysis',
  'roc': 'receiver operating characteristic auc',
  'mcmc': 'markov chain monte carlo bayesian stan',

  // Epidemiology/Biostatistics
  'epi': 'epidemiology epidemic outbreak',
  'rr': 'relative risk risk ratio',
  'or': 'odds ratio logistic',
  'hr': 'hazard ratio survival cox',
  'r0': 'basic reproduction number reproductive',
  'rt': 'effective reproduction number epinow',
  've': 'vaccine effectiveness efficacy',
  'pk': 'pharmacokinetic drug concentration',
  'pd': 'pharmacodynamic drug effect',
  'pkpd': 'pharmacokinetic pharmacodynamic nlmixr',
  'km': 'kaplan meier survival curve',
  'cox': 'proportional hazards survival',
  'rct': 'randomized controlled trial clinical',
  'gwas': 'genome wide association snp',

  // Time series
  'ts': 'time series forecast temporal',
  'arima': 'autoregressive time series forecast',
  'var': 'vector autoregression multivariate',
  'garch': 'volatility heteroskedasticity',
  'ets': 'exponential smoothing forecast',

  // Spatial
  'gis': 'geographic information system spatial',
  'crs': 'coordinate reference system projection',
  'osm': 'openstreetmap mapping',

  // Data manipulation
  'tables': 'table data.table tidytable',
  'dataframe': 'data frame data.table tibble',
  'dataframes': 'data frame data.table tibble',
  'etl': 'extract transform load pipeline',
  'regex': 'regular expression pattern stringr',
  'json': 'jsonlite parse api',
  'xml': 'xml2 parse html',
  'csv': 'read write readr fread',
  'xlsx': 'excel spreadsheet readxl openxlsx',

  // Web/API
  'api': 'http rest request httr',
  'sql': 'database query dbi dbplyr',
  'html': 'web scrape rvest',
  'pdf': 'document pdftools extract',

  // Reporting
  'rmd': 'rmarkdown markdown knitr',
  'qmd': 'quarto markdown document',
  'latex': 'tex pdf tinytex',

  // Development
  'pkg': 'package devtools usethis',
  'tdd': 'test driven testthat',
  'oop': 'object oriented r6 s4',

  // Frequency/contingency tables
  'frequency': 'freq count tabulate tabyl crosstab contingency vcd',
  'crosstab': 'cross tabulation contingency two-way frequency',
  'contingency': 'crosstab categorical frequency table vcd',
  'mosaic': 'mosaic plot vcd ggmosaic categorical',
  'categorical': 'factor discrete nominal ordinal contingency frequency'
};

// Expand abbreviations in search query
function expandQuery(query) {
  let expanded = query;
  for (const [abbrev, full] of Object.entries(queryExpansions)) {
    // Match whole words only (case-insensitive)
    const regex = new RegExp(`\\b${abbrev}\\b`, 'gi');
    if (regex.test(expanded)) {
      // Add both the abbreviation and expansion for broader matching
      expanded = expanded.replace(regex, `${abbrev} ${full}`);
    }
  }
  return expanded;
}

// Fuse.js configuration based on Elasticsearch/BM25 field boosting patterns
// Reference: Elasticsearch best practices use title^3, description^1, keywords^1.5
// Adapted for functionality-first package discovery
const fuseOptions = {
  keys: [
    { name: 'package_name', weight: 5.0 },    // ^5 boost (exact name searches must work!)
    { name: 'title', weight: 4.0 },           // ^4 boost (what the package does)
    { name: 'description', weight: 2.0 },     // ^2 (detailed content matters)
    { name: 'topics', weight: 2.5 },          // ^2.5 boost (keywords/tags are important)
    { name: 'exports', weight: 1.0 }          // ^1 (function names can indicate functionality)
  ],
  isCaseSensitive: false,    // Case-insensitive search
  threshold: 0.6,            // More lenient fuzzy matching
  distance: 200,
  includeScore: true,
  includeMatches: true,
  minMatchCharLength: 2,
  ignoreLocation: true,
  findAllMatches: true
};

// Initialize search on page load
async function initSearch() {
  const statusEl = document.getElementById('search-status');

  try {
    if (statusEl) statusEl.textContent = 'Loading package index...';

    // Load packages, review stats, and categories in parallel
    // Use lightweight index (14MB) instead of full packages.json (42MB)
    const [packagesResponse, reviewsResponse, categoriesResponse] = await Promise.all([
      fetch('/data/packages-search.json'),
      fetch('/api/reviews').catch(() => ({ ok: false })),
      fetch('/data/categories-meta.json').catch(() => ({ ok: false }))
    ]);

    // Load categories for suggestions
    if (categoriesResponse.ok) {
      try {
        categoriesData = await categoriesResponse.json();
      } catch (e) {
        console.warn('Failed to parse categories:', e);
      }
    }

    if (!packagesResponse.ok) {
      throw new Error(`Failed to load search index: ${packagesResponse.status}`);
    }

    searchIndex = await packagesResponse.json();

    // Load review stats if available
    if (reviewsResponse.ok) {
      try {
        const reviewsData = await reviewsResponse.json();
        reviewStats = reviewsData.stats || {};
        console.log(`Loaded review stats for ${Object.keys(reviewStats).length} packages`);
      } catch (e) {
        console.warn('Failed to parse review stats:', e);
      }
    }

    // Prepare packages for Fuse.js - flatten arrays to strings for searching
    const searchablePackages = searchIndex.packages.map(pkg => ({
      ...pkg,
      exports: Array.isArray(pkg.exports) ? pkg.exports.join(' ') : '',
      // Flatten nested arrays and convert hyphens to spaces for better matching
      // e.g., [["reproduction-number"]] -> "reproduction number"
      topics: Array.isArray(pkg.topics)
        ? pkg.topics.flat().join(' ').replace(/-/g, ' ')
        : ''
    }));

    fuse = new Fuse(searchablePackages, fuseOptions);
    isSearchReady = true;

    if (statusEl) statusEl.textContent = '';
    console.log(`Search ready: ${searchIndex.packages.length} packages indexed`);

    // Update package count display
    updatePackageCount(searchIndex.packages.length);

  } catch (error) {
    console.error('Search initialization failed:', error);
    if (statusEl) {
      statusEl.innerHTML = '<span class="search-error">Search unavailable. <a href="categories/">Browse categories</a> instead.</span>';
    }
  }
}

// Perform search and return results
// First checks for direct name matches, then uses Fuse.js for fuzzy search
function searchPackages(query) {
  if (!searchIndex || !query || query.trim().length < 2) {
    return [];
  }

  const queryLower = query.trim().toLowerCase();

  // Check for exact name match first
  const exactMatch = searchIndex.packages.find(pkg =>
    (pkg.package_name || '').toLowerCase() === queryLower
  );

  // If exact match found, return just that package
  if (exactMatch) {
    return [{
      ...exactMatch,
      searchScore: 0,
      reviewStats: reviewStats[exactMatch.package_name] || null
    }];
  }

  // Find partial name matches (query is part of name or name is part of query)
  const directMatches = searchIndex.packages.filter(pkg => {
    const name = (pkg.package_name || '').toLowerCase();
    return name.includes(queryLower) || queryLower.includes(name);
  });

  // If we have direct name matches, return only those (limited)
  if (directMatches.length > 0 && directMatches.length <= 10) {
    return directMatches.map(pkg => ({
      ...pkg,
      searchScore: 0,
      reviewStats: reviewStats[pkg.package_name] || null
    })).sort((a, b) => {
      // Sort by name length (shorter = more relevant for partial matches)
      return a.package_name.length - b.package_name.length;
    });
  }

  // For general queries, use Fuse.js fuzzy search
  // Expand abbreviations (e.g., "LLM" -> "LLM large language model") for better matching
  const expandedQuery = expandQuery(query.trim());
  let fuseResults = [];
  if (fuse) {
    fuseResults = fuse.search(expandedQuery, { limit: 50 });
  }

  // Combine: direct matches first, then fuse results (avoiding duplicates)
  const directIds = new Set(directMatches.map(p => p.id));
  const combined = [
    ...directMatches.slice(0, 5).map(pkg => ({
      ...pkg,
      searchScore: 0,
      reviewStats: reviewStats[pkg.package_name] || null
    })),
    ...fuseResults
      .filter(r => !directIds.has(r.item.id))
      .map(r => {
        const original = searchIndex.packages.find(p => p.id === r.item.id) || r.item;
        return {
          ...original,
          searchScore: r.score,
          reviewStats: reviewStats[original.package_name] || null
        };
      })
  ];

  // Sort by score, reviews, quality, stars
  return combined.sort((a, b) => {
    // Primary: Search score (lower = better, direct matches are 0)
    if (a.searchScore !== b.searchScore) return a.searchScore - b.searchScore;

    // Secondary: User reviews
    const reviewScoreA = getReviewRankingScore(a.reviewStats);
    const reviewScoreB = getReviewRankingScore(b.reviewStats);
    if (reviewScoreB !== reviewScoreA) return reviewScoreB - reviewScoreA;

    // Tertiary: Quality score
    const qualityA = parseFloat(a.score) || 0;
    const qualityB = parseFloat(b.score) || 0;
    if (qualityB !== qualityA) return qualityB - qualityA;

    // Quaternary: Stars
    return (b.stars || 0) - (a.stars || 0);
  }).slice(0, 15);
}

// Calculate ranking score from reviews (similar to Google Reviews algorithm)
// Combines average rating with review count, with diminishing returns for count
function getReviewRankingScore(stats) {
  if (!stats || stats.count === 0) return 0;
  const avgRating = stats.avg || 0;
  const reviewCount = stats.count || 0;
  // Bayesian average approach: weight by log of count (diminishing returns)
  // A 4.5 star with 10 reviews beats 5 star with 1 review
  return avgRating * Math.log10(reviewCount + 1);
}

// Find matching categories for a search query
function findMatchingCategories(query) {
  if (!categoriesData || !query) return [];

  const queryLower = query.toLowerCase();
  const matches = [];

  // Flatten all categories from sections
  const allCategories = [];
  for (const section of categoriesData.sections || []) {
    for (const cat of section.categories || []) {
      allCategories.push(cat);
    }
  }

  for (const category of allCategories) {
    let score = 0;

    // Check keyword mappings (highest priority)
    const keywords = categoryKeywords[category.id] || [];
    for (const keyword of keywords) {
      if (queryLower.includes(keyword)) {
        score += 10;
        break;
      }
    }

    // Check category name
    if (queryLower.includes(category.name.toLowerCase()) ||
        category.name.toLowerCase().includes(queryLower)) {
      score += 5;
    }

    // Check description
    if (category.description && category.description.toLowerCase().includes(queryLower)) {
      score += 3;
    }

    // Check featured packages
    for (const pkg of category.featured || []) {
      if (queryLower.includes(pkg.toLowerCase())) {
        score += 2;
        break;
      }
    }

    if (score > 0) {
      matches.push({ ...category, score });
    }
  }

  // Sort by score and return top matches
  return matches.sort((a, b) => b.score - a.score).slice(0, 2);
}

// Pagination state
const RESULTS_PER_PAGE = 20;
let currentResultsShown = 0;
let allSearchResults = [];

// Render search results to DOM
function renderSearchResults(results, containerId = 'search-results') {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Store all results
  allSearchResults = results;
  currentResultsShown = 0;
  lastSearchResults = results;
  lastSearchQuery = document.getElementById('package-search')?.value || '';

  // Hide discover section when showing results
  if (typeof hideDiscoverSection === 'function') {
    hideDiscoverSection();
  }

  if (!isSearchReady) {
    container.innerHTML = `
      <div class="search-results-box">
        <p>Loading search index...</p>
      </div>
    `;
    return;
  }

  if (results.length === 0) {
    container.innerHTML = `
      <div class="search-results-box search-no-results">
        <p><strong>No packages found</strong></p>
        <p>Try different keywords or <a href="categories/">browse categories</a>.</p>
      </div>
    `;
    return;
  }

  // Show compare button when 2+ results
  const compareButtonHtml = results.length >= 2 ? `
    <button class="compare-ai-btn" onclick="openCompareChat()">
      <i class="bi bi-robot"></i> Compare with AI
    </button>
  ` : '';

  // Find matching categories for the query
  const matchingCategories = findMatchingCategories(lastSearchQuery);
  const categorySuggestionHtml = matchingCategories.length > 0 ? `
    <div class="category-suggestion">
      <span class="suggestion-label">You may be interested in:</span>
      ${matchingCategories.map(cat => `
        <a href="categories/${cat.id}.html" class="category-suggestion-link">
          <span class="category-emoji">${cat.emoji}</span>
          <span class="category-name">${escapeHtml(cat.name)}</span>
          <span class="category-desc">collection</span>
        </a>
      `).join('')}
    </div>
  ` : '';

  // Show first batch of results
  const initialResults = results.slice(0, RESULTS_PER_PAGE);
  currentResultsShown = initialResults.length;

  const showMoreHtml = results.length > RESULTS_PER_PAGE ? `
    <button class="show-more-btn" onclick="showMoreResults()">
      Show more (${results.length - RESULTS_PER_PAGE} remaining)
    </button>
  ` : '';

  const html = `
    <div class="search-results-box">
      <div class="results-header">
        <p class="results-count">Found ${results.length} package${results.length !== 1 ? 's' : ''}</p>
        ${compareButtonHtml}
      </div>
      ${categorySuggestionHtml}
      <div class="package-list" id="package-list">
        ${initialResults.map(pkg => renderPackageCard(pkg)).join('')}
      </div>
      <div id="show-more-container">
        ${showMoreHtml}
      </div>
    </div>
  `;

  container.innerHTML = html;
}

// Show more results
function showMoreResults() {
  const packageList = document.getElementById('package-list');
  const showMoreContainer = document.getElementById('show-more-container');
  if (!packageList || !showMoreContainer) return;

  const nextBatch = allSearchResults.slice(currentResultsShown, currentResultsShown + RESULTS_PER_PAGE);
  currentResultsShown += nextBatch.length;

  // Append new results
  packageList.insertAdjacentHTML('beforeend', nextBatch.map(pkg => renderPackageCard(pkg)).join(''));

  // Update or remove show more button
  const remaining = allSearchResults.length - currentResultsShown;
  if (remaining > 0) {
    showMoreContainer.innerHTML = `
      <button class="show-more-btn" onclick="showMoreResults()">
        Show more (${remaining} remaining)
      </button>
    `;
  } else {
    showMoreContainer.innerHTML = '';
  }
}

// Export for global use
window.showMoreResults = showMoreResults;

// Get package logo URL from GitHub
function getPackageLogoUrl(pkg) {
  // Try to extract GitHub repo from URL or repository field
  const urls = [pkg.url, pkg.repository, pkg.bug_reports].filter(Boolean).join(' ');
  const ghMatch = urls.match(/github\.com\/([^\/]+)\/([^\/\s,]+)/);

  if (ghMatch) {
    const [, owner, repo] = ghMatch;
    // Clean repo name (remove .git, trailing slashes, etc.)
    const cleanRepo = repo.replace(/\.git$/, '').replace(/\/$/, '');
    return `https://raw.githubusercontent.com/${owner}/${cleanRepo}/HEAD/man/figures/logo.png`;
  }

  // No GitHub URL found
  return null;
}

// Render individual package card
function renderPackageCard(pkg) {
  const scoreNum = pkg.score ? parseFloat(pkg.score) : null;
  const score = scoreNum ? scoreNum.toFixed(1) : 'N/A';
  const scoreClass = scoreNum >= 80 ? 'score-high' : scoreNum >= 50 ? 'score-medium' : 'score-low';

  // Internal package page URL
  const packagePageUrl = `/packages/${encodeURIComponent(pkg.package_name)}`;

  // External source URL - prefer repository, then url
  const sourceUrl = pkg.repository || pkg.url || `https://r-universe.dev/search?q=${pkg.package_name}`;

  // Get logo URL
  const logoUrl = getPackageLogoUrl(pkg);

  // Format topics/tags
  const topicsHtml = renderTopics(pkg.topics);

  // Format review summary
  const reviewHtml = renderReviewSummary(pkg.reviewStats, pkg.package_name);

  // Build logo HTML - only include img if we have a URL
  const logoHtml = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="" class="package-logo"
           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
       <div class="package-logo-fallback" style="display:none;"><i class="bi bi-box-seam"></i></div>`
    : `<div class="package-logo-fallback"><i class="bi bi-box-seam"></i></div>`;

  return `
    <div class="package-card">
      <div class="package-header">
        ${logoHtml}
        <div class="package-header-text">
          <h3 class="package-title">
            <a href="${escapeHtml(packagePageUrl)}">${escapeHtml(pkg.package_name)}</a>
          </h3>
          ${scoreNum ? `<span class="package-score ${scoreClass}" title="R-universe quality score">${score}</span>` : ''}
        </div>
      </div>
      <p class="package-description">${escapeHtml(pkg.title || pkg.description || 'No description available')}</p>
      ${reviewHtml}
      <div class="package-meta">
        <span class="meta-item" title="GitHub stars"><i class="bi bi-star"></i> ${pkg.stars || 0}</span>
        <span class="meta-item" title="Category"><i class="bi bi-folder"></i> ${escapeHtml(pkg.primary_category || 'Uncategorized')}</span>
        <span class="meta-item" title="Version"><i class="bi bi-tag"></i> ${escapeHtml(pkg.version || '?')}</span>
      </div>
      ${topicsHtml}
      <div class="package-actions">
        <button class="btn-review" onclick="openFeedback('${escapeHtml(pkg.package_name)}')">
          <i class="bi bi-star"></i> Review
        </button>
        <a href="${escapeHtml(packagePageUrl)}" class="btn-view">
          <i class="bi bi-info-circle"></i> Details
        </a>
        <a href="${escapeHtml(sourceUrl)}" class="btn-source" target="_blank" rel="noopener">
          <i class="bi bi-box-arrow-up-right"></i> Source
        </a>
      </div>
    </div>
  `;
}

// Render review summary (stars and count) for package card
function renderReviewSummary(stats, packageName) {
  if (!stats || stats.count === 0) {
    return `
      <div class="package-review-summary package-review-empty" onclick="openFeedback('${escapeHtml(packageName)}')" title="Be the first to review this package">
        <i class="bi bi-star"></i> <span class="review-cta">Be first to review</span>
      </div>
    `;
  }

  const avgRating = stats.avg || 0;
  const fullStars = Math.floor(avgRating);
  const hasHalfStar = avgRating - fullStars >= 0.5;
  const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

  const starsHtml =
    '<span class="review-stars">' +
    '★'.repeat(fullStars) +
    (hasHalfStar ? '½' : '') +
    '</span>' +
    '<span class="review-stars-empty">' + '☆'.repeat(emptyStars) + '</span>';

  return `
    <div class="package-review-summary" onclick="openFeedback('${escapeHtml(packageName)}')" title="Click to read or write reviews">
      ${starsHtml}
      <span class="review-avg">${avgRating.toFixed(1)}</span>
      <span class="review-count">(${stats.count} review${stats.count !== 1 ? 's' : ''})</span>
    </div>
  `;
}

// Show preview of exported functions
function renderExportPreview(exports) {
  if (!exports || !Array.isArray(exports) || exports.length === 0) return '';

  const previewExports = exports.slice(0, 5);
  const remaining = exports.length - 5;

  return `
    <div class="exports-preview">
      <span class="exports-label">Key functions: </span>
      <code>${previewExports.map(e => escapeHtml(e)).join('</code>, <code>')}</code>
      ${remaining > 0 ? `<span class="exports-more">+${remaining} more</span>` : ''}
    </div>
  `;
}

// Render topic tags
function renderTopics(topics) {
  if (!topics || !Array.isArray(topics) || topics.length === 0) return '';

  const displayTopics = topics.slice(0, 4);

  return `
    <div class="package-topics">
      ${displayTopics.map(t => `<span class="topic-tag">${escapeHtml(t)}</span>`).join('')}
    </div>
  `;
}

// Format large numbers
function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

// Update package count display on homepage
function updatePackageCount(count) {
  const el = document.getElementById('package-count');
  if (el && count > 0) {
    el.textContent = `Discover ${count.toLocaleString()}+ R packages`;
  }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Search cache (localStorage only - no pre-seeded results to ensure new packages are discoverable)
// v2: invalidate cache after switching to pure AI semantic search
const SEARCH_CACHE_KEY = 'warehouse_search_cache_v2';
const SEARCH_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function getSearchCache() {
  try {
    const cached = localStorage.getItem(SEARCH_CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      // Check if cache is still valid
      if (Date.now() - data.timestamp < SEARCH_CACHE_TTL) {
        return data.searches || {};
      }
    }
  } catch (e) {}
  return {};
}

function setSearchCache(query, packageNames) {
  try {
    const cache = getSearchCache();
    cache[query.toLowerCase()] = packageNames;
    localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify({
      timestamp: Date.now(),
      searches: cache
    }));
  } catch (e) {}
}

function getCachedSearch(query) {
  const q = query.toLowerCase();
  const cache = getSearchCache();
  return cache[q] || null;
}

// AI-powered semantic search with caching
async function aiSearch(query) {
  // Check cache first
  const cached = getCachedSearch(query);
  if (cached) {
    console.log('Using cached search results for:', query);
    return lookupPackages(cached);
  }

  // Call API with timeout (Netlify functions have 10s limit)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    console.log('Calling AI search API for:', query);
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('AI search returned error:', response.status, errorData);
      throw new Error(`AI search failed: ${response.status}`);
    }

    const data = await response.json();
    console.log('AI search response:', data);
    const packageNames = data.packages || [];

    // Cache the results
    if (packageNames.length > 0) {
      setSearchCache(query, packageNames);
    }

    return lookupPackages(packageNames);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.warn('AI search timed out');
    }
    throw error;
  }
}

// Look up full package data from searchIndex
function lookupPackages(packageNames) {
  if (!searchIndex || !searchIndex.packages) return [];

  const results = [];
  for (const name of packageNames) {
    const pkg = searchIndex.packages.find(
      p => p.package_name.toLowerCase() === name.toLowerCase()
    );
    if (pkg) {
      results.push({
        ...pkg,
        reviewStats: reviewStats[pkg.package_name] || null
      });
    }
  }
  return results;
}

// Main search handler - uses AI by default, falls back to local search
let isSearching = false;

async function handleSearch() {
  const searchInput = document.getElementById('package-search');
  const resultsContainer = document.getElementById('search-results');
  if (!searchInput || !resultsContainer) return;

  const query = searchInput.value.trim();

  if (query.length < 2) {
    resultsContainer.innerHTML = '';
    return;
  }

  // Prevent multiple concurrent searches
  if (isSearching) return;
  isSearching = true;

  // Show loading state
  resultsContainer.innerHTML = `
    <div class="search-results-box">
      <p class="search-loading">Searching with AI...</p>
    </div>
  `;

  try {
    // Try AI search first
    const results = await aiSearch(query);

    if (results.length > 0) {
      renderSearchResults(results);
    } else {
      // Fall back to local search if AI returns nothing
      const localResults = searchPackages(query);
      renderSearchResults(localResults);
    }
  } catch (error) {
    console.warn('AI search failed, using local search:', error);
    // Fall back to local Fuse.js search
    const localResults = searchPackages(query);
    renderSearchResults(localResults);
  } finally {
    isSearching = false;
  }
}

// Clear search results
function clearSearch() {
  const searchInput = document.getElementById('package-search');
  const resultsContainer = document.getElementById('search-results');

  if (searchInput) searchInput.value = '';
  if (resultsContainer) resultsContainer.innerHTML = '';

  // Show discover section when search is cleared
  if (typeof showDiscoverSection === 'function') {
    showDiscoverSection();
  }
}

// Open chatbot with AI comparison prompt for search results
function openCompareChat() {
  // Build package summary for AI (top 5 results)
  const packageSummary = lastSearchResults.slice(0, 5).map(pkg => {
    const rating = pkg.reviewStats?.avg ? `${pkg.reviewStats.avg.toFixed(1)} stars` : 'no reviews';
    const stars = pkg.stars || 0;
    return `- **${pkg.package_name}**: ${pkg.title || 'No description'} (${rating}, ${stars} GitHub stars)`;
  }).join('\n');

  const comparisonPrompt = `I searched for "${lastSearchQuery}" and found these packages:\n\n${packageSummary}\n\nCan you help me compare them and decide which one is best for my needs?`;

  // Open chatbot and pre-fill the message
  if (typeof toggleChat === 'function') {
    // Ensure chat is open
    const chatContainer = document.getElementById('chat-container');
    if (!chatContainer || chatContainer.style.display === 'none') {
      toggleChat();
    }

    // Pre-fill the input
    setTimeout(() => {
      if (typeof prefillChat === 'function') {
        prefillChat(comparisonPrompt, true); // auto-send
      } else {
        const chatInput = document.getElementById('chat-input');
        if (chatInput) {
          chatInput.value = comparisonPrompt;
          chatInput.focus();
        }
      }
    }, 100);
  }
}

// Export for global use
window.openCompareChat = openCompareChat;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', function() {
  // Initialize search index
  initSearch();

  const searchInput = document.getElementById('package-search');
  if (searchInput) {
    // Clear results when input is emptied
    searchInput.addEventListener('input', function() {
      const query = searchInput.value.trim();
      if (query.length === 0) {
        document.getElementById('search-results').innerHTML = '';
        // Show discover section when search is cleared
        if (typeof showDiscoverSection === 'function') {
          showDiscoverSection();
        }
      }
    });

    // AI search on Enter
    searchInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSearch();  // Uses AI
      }
    });

    // Clear on Escape
    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        clearSearch();
      }
    });
  }

  // Handle search button click - uses AI
  const searchButton = document.querySelector('.search-button-google');
  if (searchButton) {
    searchButton.addEventListener('click', function(e) {
      e.preventDefault();
      handleSearch();  // Uses AI
    });
  }

  // Keyboard shortcut: 'C' to browse categories (when not in input field)
  document.addEventListener('keydown', function(e) {
    if (e.key.toLowerCase() === 'c' &&
        !e.ctrlKey && !e.metaKey && !e.altKey &&
        document.activeElement.tagName !== 'INPUT' &&
        document.activeElement.tagName !== 'TEXTAREA') {
      window.location.href = 'categories/';
    }
  });
});
