// search.js
// Client-side fuzzy search using Fuse.js

let searchIndex = null;
let fuse = null;
let isSearchReady = false;
let reviewStats = {}; // Package review statistics from Google Reviews-style system

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

    // Load packages and review stats in parallel
    const [packagesResponse, reviewsResponse] = await Promise.all([
      fetch('/data/packages.json'),
      fetch('/api/reviews').catch(() => ({ ok: false }))
    ]);

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
  let fuseResults = [];
  if (fuse) {
    fuseResults = fuse.search(query.trim(), { limit: 50 });
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

// Render search results to DOM
function renderSearchResults(results, containerId = 'search-results') {
  const container = document.getElementById(containerId);
  if (!container) return;

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
          <span class="package-score ${scoreClass}" title="R-universe quality score">${score}</span>
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
      <div class="package-review-summary">
        <span class="review-stars-empty">No reviews yet</span>
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
    <div class="package-review-summary">
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

// Escape HTML to prevent XSS
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Search cache (localStorage only - no pre-seeded results to ensure new packages are discoverable)
const CACHE_KEY = 'warehouse_search_cache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function getSearchCache() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      // Check if cache is still valid
      if (Date.now() - data.timestamp < CACHE_TTL) {
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
    localStorage.setItem(CACHE_KEY, JSON.stringify({
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

  // Call API
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    throw new Error('AI search failed');
  }

  const data = await response.json();
  const packageNames = data.packages || [];

  // Cache the results
  if (packageNames.length > 0) {
    setSearchCache(query, packageNames);
  }

  return lookupPackages(packageNames);
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

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', function() {
  // Initialize search index
  initSearch();

  const searchInput = document.getElementById('package-search');
  if (searchInput) {
    // Debounced search on input (local search for instant feedback)
    let timeout;
    searchInput.addEventListener('input', function() {
      clearTimeout(timeout);
      // Use local search for typing (faster feedback)
      timeout = setTimeout(() => {
        const query = searchInput.value.trim();
        if (query.length >= 2) {
          const localResults = searchPackages(query);
          renderSearchResults(localResults);
        } else {
          document.getElementById('search-results').innerHTML = '';
          // Show discover section when search is cleared
          if (typeof showDiscoverSection === 'function') {
            showDiscoverSection();
          }
        }
      }, 300);
    });

    // AI search on Enter
    searchInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(timeout);
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
});
