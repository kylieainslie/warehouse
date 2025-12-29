// discover.js
// Discover section UI for featuring trending, new, and rising packages

let discoverData = null;
let rweeklyData = null;
let currentTab = 'trending';

// Load discover data on page load
async function loadDiscoverData() {
  try {
    // Load both discover.json and rweekly-packages.json in parallel
    const [discoverResponse, rweeklyResponse] = await Promise.all([
      fetch('/data/discover.json'),
      fetch('/data/rweekly-packages.json').catch(() => ({ ok: false }))
    ]);

    if (!discoverResponse.ok) {
      throw new Error(`Failed to load discover data: ${discoverResponse.status}`);
    }
    discoverData = await discoverResponse.json();

    // Load R Weekly data if available
    if (rweeklyResponse.ok) {
      try {
        const rweeklyJson = await rweeklyResponse.json();
        // Transform R Weekly packages to match discover format
        rweeklyData = (rweeklyJson.packages || []).map(pkg => ({
          name: pkg.package_name,
          version: pkg.version,
          title: pkg.description ? pkg.description.split(' - ')[0] : pkg.package_name,
          description: pkg.description || '',
          url: pkg.url,
          week: pkg.week,
          type: pkg.type, // 'new' or 'updated'
          stars: 0,
          downloads: 0
        }));
        console.log(`Loaded ${rweeklyData.length} R Weekly packages`);
      } catch (e) {
        console.warn('Failed to parse R Weekly data:', e);
        rweeklyData = [];
      }
    } else {
      rweeklyData = [];
    }

    // Deduplicate packages by name within each category
    if (discoverData.trending) {
      discoverData.trending = deduplicatePackages(discoverData.trending);
    }
    if (discoverData.new) {
      discoverData.new = deduplicatePackages(discoverData.new);
    }
    if (discoverData.rising) {
      discoverData.rising = deduplicatePackages(discoverData.rising);
    }

    renderDiscoverSection();
  } catch (error) {
    console.error('Failed to load discover data:', error);
    // Hide discover section if data fails to load
    const section = document.getElementById('discover-section');
    if (section) {
      section.style.display = 'none';
    }
  }
}

// Deduplicate packages by name (keep first occurrence)
function deduplicatePackages(packages) {
  const seen = new Set();
  return packages.filter(pkg => {
    if (seen.has(pkg.name)) {
      return false;
    }
    seen.add(pkg.name);
    return true;
  });
}

// Render the discover section
function renderDiscoverSection() {
  const container = document.getElementById('discover-packages');
  if (!container) return;

  // Get packages based on current tab
  let packages;
  if (currentTab === 'rweekly') {
    packages = rweeklyData || [];
  } else {
    packages = (discoverData && discoverData[currentTab]) || [];
  }

  if (packages.length === 0) {
    container.innerHTML = '<p class="discover-empty">No packages available</p>';
    return;
  }

  // Create horizontal scrollable card container
  const cardsHtml = packages.map(pkg => createDiscoverCard(pkg)).join('');

  container.innerHTML = `
    <div class="discover-scroll-container">
      <button class="discover-scroll-btn discover-scroll-left" onclick="scrollDiscover(-1)" aria-label="Scroll left">
        <i class="bi bi-chevron-left"></i>
      </button>
      <div class="discover-cards" id="discover-cards">
        ${cardsHtml}
      </div>
      <button class="discover-scroll-btn discover-scroll-right" onclick="scrollDiscover(1)" aria-label="Scroll right">
        <i class="bi bi-chevron-right"></i>
      </button>
    </div>
  `;

  updateScrollButtons();
}

// Create a single discover card
function createDiscoverCard(pkg) {
  const title = pkg.title || pkg.name;
  const description = pkg.description ?
    (pkg.description.length > 100 ? pkg.description.substring(0, 100) + '...' : pkg.description) :
    'No description available';

  // Format numbers
  const downloads = formatNumber(pkg.downloads || 0);
  const stars = formatNumber(pkg.stars || 0);

  const packagePageUrl = `/packages/${encodeURIComponent(pkg.name)}`;

  // R Weekly badge for rweekly tab
  const rweeklyBadge = pkg.week ?
    `<span class="discover-card-badge ${pkg.type === 'new' ? 'badge-new' : 'badge-updated'}">${pkg.type === 'new' ? 'New' : 'Updated'}</span>` : '';

  // Stats - show week for R Weekly, otherwise stars/downloads
  const statsHtml = pkg.week ?
    `<span class="discover-stat"><i class="bi bi-calendar"></i> ${escapeHtml(pkg.week)}</span>` :
    `<span class="discover-stat"><i class="bi bi-star-fill"></i> ${stars}</span>
     <span class="discover-stat"><i class="bi bi-download"></i> ${downloads}</span>`;

  return `
    <a href="${packagePageUrl}" class="discover-card">
      <div class="discover-card-header">
        <div class="discover-card-tags">
          ${rweeklyBadge}
          <span class="discover-card-version">${escapeHtml(pkg.version || '')}</span>
        </div>
        <span class="discover-card-name">${escapeHtml(pkg.name)}</span>
      </div>
      <div class="discover-card-title">${escapeHtml(title)}</div>
      <div class="discover-card-desc">${escapeHtml(description)}</div>
      <div class="discover-card-stats">
        ${statsHtml}
      </div>
    </a>
  `;
}

// Format large numbers (e.g., 1234567 -> 1.2M)
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Switch between tabs
function switchDiscoverTab(tab) {
  // Validate tab exists (either in discoverData or is rweekly)
  if (tab === 'rweekly') {
    if (!rweeklyData || rweeklyData.length === 0) return;
  } else {
    if (!discoverData || !discoverData[tab]) return;
  }

  currentTab = tab;

  // Update tab buttons
  document.querySelectorAll('.discover-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Re-render packages
  renderDiscoverSection();
}

// Scroll the discover cards
function scrollDiscover(direction) {
  const container = document.getElementById('discover-cards');
  if (!container) return;

  const cardWidth = 220; // Width of card + gap
  const scrollAmount = cardWidth * 2;

  container.scrollBy({
    left: direction * scrollAmount,
    behavior: 'smooth'
  });

  // Update button states after scroll
  setTimeout(updateScrollButtons, 300);
}

// Update scroll button visibility
function updateScrollButtons() {
  const container = document.getElementById('discover-cards');
  if (!container) return;

  const leftBtn = document.querySelector('.discover-scroll-left');
  const rightBtn = document.querySelector('.discover-scroll-right');

  if (leftBtn) {
    leftBtn.style.opacity = container.scrollLeft > 0 ? '1' : '0.3';
  }

  if (rightBtn) {
    const maxScroll = container.scrollWidth - container.clientWidth;
    rightBtn.style.opacity = container.scrollLeft < maxScroll - 10 ? '1' : '0.3';
  }
}

// Hide discover section when searching
function hideDiscoverSection() {
  const section = document.getElementById('discover-section');
  if (section) {
    section.style.display = 'none';
  }
}

// Show discover section
function showDiscoverSection() {
  const section = document.getElementById('discover-section');
  if (section) {
    section.style.display = 'block';
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  loadDiscoverData();

  // Add scroll event listener for button updates
  const container = document.getElementById('discover-cards');
  if (container) {
    container.addEventListener('scroll', updateScrollButtons);
  }
});
