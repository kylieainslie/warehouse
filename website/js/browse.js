// browse.js
// Dynamic browse page with collapsible sections and Discover-style featured packages

let categoriesData = null;
let packageCounts = {};
let packagesData = null;

// Load categories metadata and render
async function initBrowsePage() {
  try {
    // Load categories metadata
    const response = await fetch('/data/categories-meta.json');
    if (!response.ok) {
      throw new Error('Failed to load categories metadata');
    }
    categoriesData = await response.json();

    // Load package data for logo lookups
    await loadPackageData();

    // Render the browse page
    renderBrowsePage();

    // Restore collapsed/expanded state from localStorage
    restoreSectionState();

    // Initialize scroll button states
    setTimeout(initScrollButtons, 100);

  } catch (error) {
    console.error('Failed to initialize browse page:', error);
    document.getElementById('browse-container').innerHTML = `
      <div class="browse-error">
        <p>Failed to load categories. Please try refreshing the page.</p>
      </div>
    `;
  }
}

// Load package data from main packages.json
async function loadPackageData() {
  try {
    const response = await fetch('/data/packages.json');
    if (response.ok) {
      const data = await response.json();
      packagesData = {};
      // Build lookup by package name
      if (data.packages) {
        data.packages.forEach(pkg => {
          packagesData[pkg.package_name.toLowerCase()] = pkg;
          // Count packages by primary_category
          const category = pkg.primary_category || 'general';
          packageCounts[category] = (packageCounts[category] || 0) + 1;
        });
        packageCounts['all'] = data.packages.length;
      }
    }
  } catch (error) {
    console.warn('Failed to load package data:', error);
  }
}

// Get package info for featured package
function getPackageInfo(packageName) {
  if (!packagesData) return null;
  return packagesData[packageName.toLowerCase()] || null;
}

// Get package logo URL
function getPackageLogoUrl(pkg) {
  if (!pkg) return null;
  // Try to construct R-universe logo URL
  if (pkg.universe) {
    return `https://${pkg.universe}.r-universe.dev/${pkg.package_name}/logo.png`;
  }
  // Fallback to common R-universe patterns
  return `https://r-universe.dev/${pkg.package_name}/logo.png`;
}

// Render the entire browse page
function renderBrowsePage() {
  const container = document.getElementById('browse-container');
  if (!container || !categoriesData) return;

  const sectionsHtml = categoriesData.sections.map(section =>
    renderSection(section)
  ).join('');

  container.innerHTML = sectionsHtml;
}

// Render a single section with its categories
function renderSection(section) {
  const categoryCount = section.categories.length;
  const isExpanded = section.expanded;

  const categoriesHtml = section.categories.map(cat =>
    renderCategoryCard(cat)
  ).join('');

  return `
    <div class="browse-section" data-section-id="${section.id}">
      <button class="section-header ${isExpanded ? 'expanded' : ''}"
              onclick="toggleSection('${section.id}')"
              aria-expanded="${isExpanded}">
        <span class="section-chevron">
          <i class="bi bi-chevron-right"></i>
        </span>
        <span class="section-name">${section.name}</span>
        <span class="section-count">${categoryCount} categories</span>
      </button>
      <div class="section-content ${isExpanded ? 'expanded' : ''}">
        <div class="category-cards">
          ${categoriesHtml}
        </div>
      </div>
    </div>
  `;
}

// Render a single category card with Discover-style featured packages
function renderCategoryCard(category) {
  const count = packageCounts[category.id] || 0;
  const countDisplay = count > 0 ? `${count} packages` : '';
  const cardId = `featured-${category.id}`;

  // Build featured packages as Discover-style tiles
  const featuredHtml = category.featured.map(pkgName => {
    const pkg = getPackageInfo(pkgName);
    const logoUrl = pkg ? getPackageLogoUrl(pkg) : null;
    const pkgUrl = `https://r-universe.dev/search?q=${encodeURIComponent(pkgName)}`;

    return `
      <a href="${pkgUrl}"
         target="_blank"
         rel="noopener noreferrer"
         class="featured-tile"
         onclick="event.stopPropagation()">
        <div class="featured-tile-logo">
          ${logoUrl ?
            `<img src="${logoUrl}" alt="${escapeHtml(pkgName)}" onerror="this.parentElement.innerHTML='<span class=\\'featured-tile-fallback\\'>${escapeHtml(pkgName.charAt(0).toUpperCase())}</span>'" />` :
            `<span class="featured-tile-fallback">${escapeHtml(pkgName.charAt(0).toUpperCase())}</span>`
          }
        </div>
        <span class="featured-tile-name">${escapeHtml(pkgName)}</span>
      </a>
    `;
  }).join('');

  return `
    <div class="category-card" data-category="${category.id}">
      <a href="/categories/${category.id}.qmd" class="category-card-link">
        <div class="card-header">
          <span class="card-emoji">${category.emoji}</span>
          <div class="card-title-area">
            <span class="card-name">${escapeHtml(category.name)}</span>
            ${countDisplay ? `<span class="card-count">${countDisplay}</span>` : ''}
          </div>
        </div>
        <p class="card-description">${escapeHtml(category.description)}</p>
      </a>
      <div class="card-featured">
        <span class="featured-label">Featured:</span>
        <div class="featured-scroll-container">
          <button class="featured-scroll-btn featured-scroll-left"
                  onclick="scrollFeatured('${cardId}', -1)"
                  aria-label="Scroll left">
            <i class="bi bi-chevron-left"></i>
          </button>
          <div class="featured-tiles" id="${cardId}">
            ${featuredHtml}
          </div>
          <button class="featured-scroll-btn featured-scroll-right"
                  onclick="scrollFeatured('${cardId}', 1)"
                  aria-label="Scroll right">
            <i class="bi bi-chevron-right"></i>
          </button>
        </div>
      </div>
    </div>
  `;
}

// Scroll featured packages
function scrollFeatured(containerId, direction) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const scrollAmount = 100;
  container.scrollBy({
    left: direction * scrollAmount,
    behavior: 'smooth'
  });

  // Update button states after scroll
  setTimeout(() => updateFeaturedScrollButtons(containerId), 300);
}

// Update featured scroll button visibility
function updateFeaturedScrollButtons(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const scrollContainer = container.closest('.featured-scroll-container');
  if (!scrollContainer) return;

  const leftBtn = scrollContainer.querySelector('.featured-scroll-left');
  const rightBtn = scrollContainer.querySelector('.featured-scroll-right');

  if (leftBtn) {
    leftBtn.style.opacity = container.scrollLeft > 0 ? '1' : '0.3';
  }

  if (rightBtn) {
    const maxScroll = container.scrollWidth - container.clientWidth;
    rightBtn.style.opacity = container.scrollLeft < maxScroll - 5 ? '1' : '0.3';
  }
}

// Initialize all scroll buttons
function initScrollButtons() {
  document.querySelectorAll('.featured-tiles').forEach(container => {
    updateFeaturedScrollButtons(container.id);
    container.addEventListener('scroll', () => {
      updateFeaturedScrollButtons(container.id);
    });
  });
}

// Toggle section expand/collapse
function toggleSection(sectionId) {
  const section = document.querySelector(`[data-section-id="${sectionId}"]`);
  if (!section) return;

  const header = section.querySelector('.section-header');
  const content = section.querySelector('.section-content');

  const isExpanded = header.classList.contains('expanded');

  if (isExpanded) {
    header.classList.remove('expanded');
    content.classList.remove('expanded');
    header.setAttribute('aria-expanded', 'false');
  } else {
    header.classList.add('expanded');
    content.classList.add('expanded');
    header.setAttribute('aria-expanded', 'true');
    // Initialize scroll buttons when section expands
    setTimeout(() => {
      section.querySelectorAll('.featured-tiles').forEach(container => {
        updateFeaturedScrollButtons(container.id);
      });
    }, 100);
  }

  // Save state to localStorage
  saveSectionState();
}

// Save section expanded/collapsed state
function saveSectionState() {
  const sections = document.querySelectorAll('.browse-section');
  const state = {};

  sections.forEach(section => {
    const id = section.dataset.sectionId;
    const header = section.querySelector('.section-header');
    state[id] = header.classList.contains('expanded');
  });

  localStorage.setItem('browsePageSectionState', JSON.stringify(state));
}

// Restore section state from localStorage
function restoreSectionState() {
  try {
    const saved = localStorage.getItem('browsePageSectionState');
    if (!saved) return;

    const state = JSON.parse(saved);

    Object.entries(state).forEach(([sectionId, isExpanded]) => {
      const section = document.querySelector(`[data-section-id="${sectionId}"]`);
      if (!section) return;

      const header = section.querySelector('.section-header');
      const content = section.querySelector('.section-content');

      if (isExpanded) {
        header.classList.add('expanded');
        content.classList.add('expanded');
        header.setAttribute('aria-expanded', 'true');
      } else {
        header.classList.remove('expanded');
        content.classList.remove('expanded');
        header.setAttribute('aria-expanded', 'false');
      }
    });
  } catch (error) {
    console.warn('Failed to restore section state:', error);
  }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Expand all sections
function expandAllSections() {
  document.querySelectorAll('.section-header').forEach(header => {
    header.classList.add('expanded');
    header.setAttribute('aria-expanded', 'true');
  });
  document.querySelectorAll('.section-content').forEach(content => {
    content.classList.add('expanded');
  });
  saveSectionState();
  // Initialize scroll buttons
  setTimeout(initScrollButtons, 100);
}

// Collapse all sections
function collapseAllSections() {
  document.querySelectorAll('.section-header').forEach(header => {
    header.classList.remove('expanded');
    header.setAttribute('aria-expanded', 'false');
  });
  document.querySelectorAll('.section-content').forEach(content => {
    content.classList.remove('expanded');
  });
  saveSectionState();
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', initBrowsePage);
