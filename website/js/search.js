// search.js
// Client-side fuzzy search using Fuse.js

let searchIndex = null;
let fuse = null;
let isSearchReady = false;

// Fuse.js configuration based on Elasticsearch/BM25 field boosting patterns
// Reference: Elasticsearch best practices use title^3, description^1, keywords^1.5
// Adapted for functionality-first package discovery
const fuseOptions = {
  keys: [
    { name: 'title', weight: 3.0 },           // ^3 boost (standard for titles)
    { name: 'description', weight: 1.0 },     // ^1 baseline (detailed content)
    { name: 'topics', weight: 1.5 },          // ^1.5 boost (keywords/tags)
    { name: 'exports', weight: 1.0 },         // ^1 (function names as content)
    { name: 'package_name', weight: 2.0 }     // ^2 (npm-style: name still matters for exact matches)
  ],
  threshold: 0.4,            // Fuzzy matching threshold
  distance: 100,             // BM25-like: prefer matches closer together
  includeScore: true,
  includeMatches: true,
  minMatchCharLength: 2,
  ignoreLocation: true,      // Don't penalize position in field
  findAllMatches: true,
  useExtendedSearch: true
};

// Initialize search on page load
async function initSearch() {
  const statusEl = document.getElementById('search-status');

  try {
    if (statusEl) statusEl.textContent = 'Loading package index...';

    const response = await fetch('/data/packages.json');
    if (!response.ok) {
      throw new Error(`Failed to load search index: ${response.status}`);
    }

    searchIndex = await response.json();

    // Prepare packages for Fuse.js - flatten arrays to strings for searching
    const searchablePackages = searchIndex.packages.map(pkg => ({
      ...pkg,
      exports: Array.isArray(pkg.exports) ? pkg.exports.join(' ') : '',
      topics: Array.isArray(pkg.topics) ? pkg.topics.join(' ') : ''
    }));

    fuse = new Fuse(searchablePackages, fuseOptions);
    isSearchReady = true;

    if (statusEl) statusEl.textContent = '';
    console.log(`Search ready: ${searchIndex.packages.length} packages indexed`);

  } catch (error) {
    console.error('Search initialization failed:', error);
    if (statusEl) {
      statusEl.innerHTML = '<span class="search-error">Search unavailable. <a href="categories/">Browse categories</a> instead.</span>';
    }
  }
}

// Perform search and return results
// Ranking based on npm search algorithm pattern:
// 1. Text relevance (from Fuse.js with BM25-style field weights)
// 2. Quality score (like npm's quality metric)
// 3. Popularity (stars, like npm's popularity metric)
function searchPackages(query) {
  if (!fuse || !query || query.trim().length < 2) {
    return [];
  }

  const results = fuse.search(query.trim(), { limit: 100 });

  return results.map(r => {
    // Get original package data with arrays intact
    const original = searchIndex.packages.find(p => p.id === r.item.id) || r.item;

    return {
      ...original,
      searchScore: r.score,  // Fuse.js score (lower = better match)
      matches: r.matches
    };
  }).sort((a, b) => {
    // Primary: Fuse.js relevance score (lower = more relevant)
    // This already incorporates field weights (title^3, description^1, etc.)
    const relevanceDiff = (a.searchScore || 1) - (b.searchScore || 1);
    if (Math.abs(relevanceDiff) > 0.1) return relevanceDiff;

    // Secondary: Quality score (like npm's quality metric)
    const qualityA = a.score || 0;
    const qualityB = b.score || 0;
    if (qualityB !== qualityA) return qualityB - qualityA;

    // Tertiary: Popularity via stars (like npm's popularity metric)
    return (b.stars || 0) - (a.stars || 0);
  }).slice(0, 50);
}

// Render search results to DOM
function renderSearchResults(results, containerId = 'search-results') {
  const container = document.getElementById(containerId);
  if (!container) return;

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

  const html = `
    <div class="search-results-box">
      <p class="results-count">Found ${results.length} package${results.length !== 1 ? 's' : ''}</p>
      <div class="package-list">
        ${results.map(pkg => renderPackageCard(pkg)).join('')}
      </div>
    </div>
  `;

  container.innerHTML = html;
}

// Render individual package card
function renderPackageCard(pkg) {
  const score = pkg.score ? pkg.score.toFixed(1) : 'N/A';
  const scoreClass = pkg.score >= 80 ? 'score-high' : pkg.score >= 50 ? 'score-medium' : 'score-low';

  // Get package URL - prefer repository, then url
  const pkgUrl = pkg.repository || pkg.url || `https://r-universe.dev/search?q=${pkg.package_name}`;

  // Format exports preview
  const exportsHtml = renderExportPreview(pkg.exports);

  // Format topics/tags
  const topicsHtml = renderTopics(pkg.topics);

  return `
    <div class="package-card">
      <div class="package-header">
        <h3 class="package-title">
          <a href="${escapeHtml(pkgUrl)}" target="_blank" rel="noopener">${escapeHtml(pkg.package_name)}</a>
        </h3>
        <span class="package-score ${scoreClass}" title="R-universe quality score">${score}</span>
      </div>
      <p class="package-description">${escapeHtml(pkg.title || pkg.description || 'No description available')}</p>
      <div class="package-meta">
        <span class="meta-item" title="GitHub stars"><i class="bi bi-star"></i> ${pkg.stars || 0}</span>
        <span class="meta-item" title="Category"><i class="bi bi-folder"></i> ${escapeHtml(pkg.primary_category || 'Uncategorized')}</span>
        <span class="meta-item" title="Version"><i class="bi bi-tag"></i> ${escapeHtml(pkg.version || '?')}</span>
      </div>
      ${exportsHtml}
      ${topicsHtml}
      <div class="package-actions">
        <button class="btn-feedback" onclick="openFeedback('${escapeHtml(pkg.package_name)}')">
          <i class="bi bi-chat"></i> Feedback
        </button>
        <a href="${escapeHtml(pkgUrl)}" class="btn-view" target="_blank" rel="noopener">
          <i class="bi bi-box-arrow-up-right"></i> View
        </a>
      </div>
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

// Escape HTML to prevent XSS
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Main search handler
function handleSearch() {
  const searchInput = document.getElementById('package-search');
  if (!searchInput) return;

  const query = searchInput.value;

  if (query.length < 2) {
    document.getElementById('search-results').innerHTML = '';
    return;
  }

  const results = searchPackages(query);
  renderSearchResults(results);
}

// Clear search results
function clearSearch() {
  const searchInput = document.getElementById('package-search');
  const resultsContainer = document.getElementById('search-results');

  if (searchInput) searchInput.value = '';
  if (resultsContainer) resultsContainer.innerHTML = '';
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', function() {
  // Initialize search index
  initSearch();

  const searchInput = document.getElementById('package-search');
  if (searchInput) {
    // Debounced search on input
    let timeout;
    searchInput.addEventListener('input', function() {
      clearTimeout(timeout);
      timeout = setTimeout(handleSearch, 300);
    });

    // Immediate search on Enter
    searchInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(timeout);
        handleSearch();
      }
    });

    // Clear on Escape
    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        clearSearch();
      }
    });
  }

  // Handle search button click
  const searchButton = document.querySelector('.search-button-google');
  if (searchButton) {
    searchButton.addEventListener('click', function(e) {
      e.preventDefault();
      handleSearch();
    });
  }
});
