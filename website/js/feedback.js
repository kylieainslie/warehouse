// feedback.js
// Google Reviews-style review system for R packages

const REVIEWS_API = '/api/reviews';

// Cache for review stats
let reviewStatsCache = null;
let reviewStatsCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Load review stats for all packages (for search ranking)
async function loadReviewStats() {
  if (reviewStatsCache && Date.now() - reviewStatsCacheTime < CACHE_TTL) {
    return reviewStatsCache;
  }

  try {
    const response = await fetch(REVIEWS_API);
    if (response.ok) {
      const data = await response.json();
      reviewStatsCache = data.stats || {};
      reviewStatsCacheTime = Date.now();
      return reviewStatsCache;
    }
  } catch (e) {
    console.warn('Failed to load review stats:', e);
  }
  return {};
}

// Get review stats for a specific package
function getPackageReviewStats(packageName) {
  if (!reviewStatsCache) return null;
  return reviewStatsCache[packageName] || null;
}

// Open review modal for a package
async function openFeedback(packageName) {
  createReviewModal();

  const modal = document.getElementById('review-modal');
  const form = document.getElementById('review-form');
  const reviewsList = document.getElementById('reviews-list');
  const packageDisplay = document.getElementById('review-package-display');
  const packageInput = document.getElementById('review-package');

  // Reset form
  if (form) form.reset();
  document.getElementById('review-status').innerHTML = '';

  // Set package name
  if (packageInput) packageInput.value = packageName;
  if (packageDisplay) packageDisplay.textContent = packageName;

  // Show modal
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // Load existing reviews
  reviewsList.innerHTML = '<p class="loading-reviews">Loading reviews...</p>';
  try {
    const response = await fetch(`${REVIEWS_API}?package=${encodeURIComponent(packageName)}`);
    const data = await response.json();

    if (data.reviews && data.reviews.length > 0) {
      reviewsList.innerHTML = data.reviews.map(renderReview).join('');
    } else {
      reviewsList.innerHTML = '<p class="no-reviews">No reviews yet. Be the first to review!</p>';
    }
  } catch (e) {
    reviewsList.innerHTML = '<p class="no-reviews">Unable to load reviews.</p>';
  }
}

// Close review modal
function closeFeedback() {
  const modal = document.getElementById('review-modal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

// Render a single review
function renderReview(review) {
  const stars = review.rating
    ? '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating)
    : '';
  const date = new Date(review.created_at).toLocaleDateString();

  return `
    <div class="review-item">
      <div class="review-header">
        <span class="review-author">${escapeHtml(review.author)}</span>
        <span class="review-rating">${stars}</span>
        <span class="review-date">${date}</span>
      </div>
      ${review.title ? `<div class="review-title">${escapeHtml(review.title)}</div>` : ''}
      <div class="review-comment">${escapeHtml(review.comment)}</div>
      ${review.use_case ? `<div class="review-usecase"><strong>Used for:</strong> ${escapeHtml(review.use_case)}</div>` : ''}
    </div>
  `;
}

// Submit a review
async function submitReview(event) {
  event.preventDefault();

  const form = event.target;
  const status = document.getElementById('review-status');
  const submitBtn = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);

  // Validate
  const comment = formData.get('comment')?.trim();
  if (!comment || comment.length < 10) {
    status.innerHTML = '<div class="alert alert-error">Please write at least 10 characters.</div>';
    return;
  }

  // Disable submit
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';
  status.innerHTML = '<div class="alert alert-info">Submitting your review...</div>';

  try {
    const response = await fetch(REVIEWS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        package_name: formData.get('package'),
        rating: formData.get('rating'),
        title: formData.get('title'),
        comment: comment,
        use_case: formData.get('usecase'),
        author: formData.get('author') || 'Anonymous'
      })
    });

    const data = await response.json();

    if (response.ok) {
      status.innerHTML = '<div class="alert alert-success">Thank you! Your review has been submitted.</div>';
      form.reset();

      // Add review to list
      const reviewsList = document.getElementById('reviews-list');
      const noReviews = reviewsList.querySelector('.no-reviews');
      if (noReviews) noReviews.remove();
      reviewsList.insertAdjacentHTML('afterbegin', renderReview(data.review));

      // Invalidate cache
      reviewStatsCache = null;
    } else {
      throw new Error(data.error || 'Failed to submit');
    }
  } catch (error) {
    console.error('Review submission error:', error);
    status.innerHTML = `<div class="alert alert-error">${error.message || 'Failed to submit review. Please try again.'}</div>`;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Review';
  }
}

// Create the review modal
function createReviewModal() {
  if (document.getElementById('review-modal')) return;

  const modalHtml = `
    <div id="review-modal" class="modal" onclick="if(event.target===this)closeFeedback()">
      <div class="modal-content modal-large">
        <button class="modal-close" onclick="closeFeedback()" aria-label="Close">&times;</button>

        <div class="review-modal-grid">
          <!-- Left: Existing Reviews -->
          <div class="reviews-section">
            <h3>Reviews for <span id="review-package-display" class="review-pkg-name"></span></h3>
            <div id="reviews-list" class="reviews-list"></div>
          </div>

          <!-- Right: Submit Review -->
          <div class="submit-section">
            <h3>Write a Review</h3>
            <form id="review-form" onsubmit="submitReview(event)">
              <input type="hidden" id="review-package" name="package">

              <div class="form-group">
                <label>Your Rating</label>
                <div class="star-rating-input">
                  <input type="radio" id="star5" name="rating" value="5"><label for="star5">★</label>
                  <input type="radio" id="star4" name="rating" value="4"><label for="star4">★</label>
                  <input type="radio" id="star3" name="rating" value="3"><label for="star3">★</label>
                  <input type="radio" id="star2" name="rating" value="2"><label for="star2">★</label>
                  <input type="radio" id="star1" name="rating" value="1"><label for="star1">★</label>
                </div>
              </div>

              <div class="form-group">
                <label for="review-title">Review Title</label>
                <input type="text" id="review-title" name="title" maxlength="100"
                       placeholder="Summarize your experience">
              </div>

              <div class="form-group">
                <label for="review-comment">Your Review <span class="required">*</span></label>
                <textarea id="review-comment" name="comment" rows="4" required
                          maxlength="1000" placeholder="What did you like or dislike? How did it help you?"></textarea>
              </div>

              <div class="form-group">
                <label for="review-usecase">What did you use it for?</label>
                <input type="text" id="review-usecase" name="usecase" maxlength="200"
                       placeholder="e.g., Estimating R0 for COVID-19 outbreak">
              </div>

              <div class="form-group">
                <label for="review-author">Your Name</label>
                <input type="text" id="review-author" name="author" maxlength="50"
                       placeholder="Anonymous">
              </div>

              <div id="review-status"></div>

              <button type="submit" class="btn-primary btn-block">Submit Review</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFeedback();
  });
}

// Escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Export functions
window.openFeedback = openFeedback;
window.closeFeedback = closeFeedback;
window.submitReview = submitReview;
window.loadReviewStats = loadReviewStats;
window.getPackageReviewStats = getPackageReviewStats;
