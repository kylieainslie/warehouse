// feedback.js
// User feedback system using GitHub Issues

// Configuration - UPDATE THIS with your GitHub repo
const GITHUB_REPO = 'kainslie/warehouse-website';  // Change to your repo

const FEEDBACK_LABELS = {
  review: 'feedback:review',
  suggestion: 'feedback:suggestion',
  correction: 'feedback:correction'
};

let feedbackModalCreated = false;

// Open feedback modal for a specific package
function openFeedback(packageName) {
  if (!feedbackModalCreated) {
    createFeedbackModal();
    feedbackModalCreated = true;
  }

  const modal = document.getElementById('feedback-modal');
  const packageInput = document.getElementById('feedback-package');
  const packageDisplay = document.getElementById('feedback-package-display');
  const form = document.getElementById('feedback-form');
  const status = document.getElementById('feedback-status');

  // Reset form
  if (form) form.reset();
  if (status) status.innerHTML = '';

  // Set package name
  if (packageInput) packageInput.value = packageName;
  if (packageDisplay) packageDisplay.textContent = packageName;

  // Show modal
  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Focus first input
    setTimeout(() => {
      const firstInput = modal.querySelector('input[type="text"], textarea');
      if (firstInput) firstInput.focus();
    }, 100);
  }
}

// Close feedback modal
function closeFeedback() {
  const modal = document.getElementById('feedback-modal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

// Create the feedback modal HTML
function createFeedbackModal() {
  const modalHtml = `
    <div id="feedback-modal" class="modal" onclick="if(event.target===this)closeFeedback()">
      <div class="modal-content">
        <button class="modal-close" onclick="closeFeedback()" aria-label="Close">&times;</button>
        <h2>Feedback for <span id="feedback-package-display" class="feedback-pkg-name"></span></h2>

        <form id="feedback-form" onsubmit="submitFeedback(event)">
          <input type="hidden" id="feedback-package" name="package">

          <div class="form-group">
            <label>Your Rating</label>
            <div class="star-rating" role="radiogroup" aria-label="Rating">
              <input type="radio" id="star5" name="rating" value="5">
              <label for="star5" title="5 stars">&#9733;</label>
              <input type="radio" id="star4" name="rating" value="4">
              <label for="star4" title="4 stars">&#9733;</label>
              <input type="radio" id="star3" name="rating" value="3">
              <label for="star3" title="3 stars">&#9733;</label>
              <input type="radio" id="star2" name="rating" value="2">
              <label for="star2" title="2 stars">&#9733;</label>
              <input type="radio" id="star1" name="rating" value="1">
              <label for="star1" title="1 star">&#9733;</label>
            </div>
          </div>

          <div class="form-group">
            <label for="feedback-type">Feedback Type</label>
            <select id="feedback-type" name="type" required>
              <option value="review">Review / Experience</option>
              <option value="suggestion">Suggestion for Categorization</option>
              <option value="correction">Correction (wrong info)</option>
            </select>
          </div>

          <div class="form-group">
            <label for="feedback-usecase">What did you use it for?</label>
            <input type="text" id="feedback-usecase" name="usecase"
                   placeholder="e.g., Estimating serial intervals for outbreak analysis">
          </div>

          <div class="form-group">
            <label for="feedback-comment">Your Feedback <span class="required">*</span></label>
            <textarea id="feedback-comment" name="comment" rows="4" required
                      placeholder="Share your experience, suggestions, or corrections..."></textarea>
          </div>

          <div class="form-group">
            <label for="feedback-name">Your Name (optional)</label>
            <input type="text" id="feedback-name" name="name"
                   placeholder="Anonymous if left blank">
          </div>

          <div id="feedback-status"></div>

          <div class="form-actions">
            <button type="button" class="btn-secondary" onclick="closeFeedback()">Cancel</button>
            <button type="submit" class="btn-primary">Submit Feedback</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  // Close on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeFeedback();
    }
  });
}

// Submit feedback - creates GitHub issue URL
async function submitFeedback(event) {
  event.preventDefault();

  const form = event.target;
  const status = document.getElementById('feedback-status');
  const formData = new FormData(form);

  // Collect feedback data
  const feedbackData = {
    package: formData.get('package'),
    type: formData.get('type'),
    rating: formData.get('rating') || 'Not rated',
    usecase: formData.get('usecase') || 'Not specified',
    comment: formData.get('comment'),
    name: formData.get('name') || 'Anonymous',
    timestamp: new Date().toISOString()
  };

  // Validate
  if (!feedbackData.comment || feedbackData.comment.trim().length < 10) {
    status.innerHTML = '<div class="alert alert-error">Please provide more detailed feedback (at least 10 characters).</div>';
    return;
  }

  status.innerHTML = '<div class="alert alert-info">Preparing feedback...</div>';

  try {
    // Format as GitHub issue
    const issueTitle = `[Feedback] ${feedbackData.package} - ${feedbackData.type}`;
    const issueBody = formatFeedbackAsIssue(feedbackData);

    // Store locally as backup
    storeFeedbackLocally(feedbackData);

    // Create GitHub issue URL
    const issueUrl = `https://github.com/${GITHUB_REPO}/issues/new?` +
      new URLSearchParams({
        title: issueTitle,
        body: issueBody,
        labels: FEEDBACK_LABELS[feedbackData.type] || 'feedback'
      }).toString();

    status.innerHTML = `
      <div class="alert alert-success">
        <p><strong>Thank you for your feedback!</strong></p>
        <p>To complete submission, click the button below to create a GitHub issue:</p>
        <a href="${issueUrl}" target="_blank" rel="noopener" class="btn-github">
          <i class="bi bi-github"></i> Submit on GitHub
        </a>
        <p class="feedback-note">A GitHub account is required. Your feedback has also been saved locally.</p>
      </div>
    `;

  } catch (error) {
    console.error('Feedback submission error:', error);
    status.innerHTML = '<div class="alert alert-error">Something went wrong. Please try again.</div>';
  }
}

// Format feedback as GitHub issue markdown
function formatFeedbackAsIssue(data) {
  const stars = data.rating !== 'Not rated'
    ? '★'.repeat(parseInt(data.rating)) + '☆'.repeat(5 - parseInt(data.rating))
    : 'Not rated';

  return `## Package Feedback

**Package:** \`${data.package}\`
**Feedback Type:** ${data.type}
**Rating:** ${stars}
**Submitted by:** ${data.name}
**Date:** ${new Date(data.timestamp).toLocaleDateString()}

### Use Case
${data.usecase}

### Feedback
${data.comment}

---
*Submitted via [The Warehouse](https://the-warehouse.netlify.app) feedback form*`;
}

// Store feedback in localStorage as backup
function storeFeedbackLocally(data) {
  try {
    const stored = JSON.parse(localStorage.getItem('warehouse_feedback') || '[]');
    stored.push(data);
    // Keep only last 50 entries
    if (stored.length > 50) stored.shift();
    localStorage.setItem('warehouse_feedback', JSON.stringify(stored));
  } catch (e) {
    console.warn('Could not store feedback locally:', e);
  }
}

// Get locally stored feedback (for debugging/export)
function getLocalFeedback() {
  try {
    return JSON.parse(localStorage.getItem('warehouse_feedback') || '[]');
  } catch (e) {
    return [];
  }
}

// Export for use in other scripts
window.openFeedback = openFeedback;
window.closeFeedback = closeFeedback;
window.submitFeedback = submitFeedback;
