// reviews.js
// Netlify serverless function to handle package reviews
// Stores reviews using GitHub API (writes to data/reviews.json in repo)

const GITHUB_OWNER = 'kylieainslie';
const GITHUB_REPO = 'warehouse';
const REVIEWS_PATH = 'website/data/reviews.json';

// Main handler
exports.handler = async function(event, context) {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // GET: Fetch reviews
  if (event.httpMethod === 'GET') {
    return await getReviews(event, headers);
  }

  // POST: Submit review
  if (event.httpMethod === 'POST') {
    return await submitReview(event, headers);
  }

  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({ error: 'Method not allowed' })
  };
};

// Fetch reviews from GitHub
async function getReviews(event, headers) {
  const packageName = event.queryStringParameters?.package;

  try {
    // Fetch reviews.json from GitHub
    const response = await fetch(
      `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/${REVIEWS_PATH}`,
      { headers: { 'Accept': 'application/json' } }
    );

    if (!response.ok) {
      // No reviews file yet
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ reviews: [], stats: {} })
      };
    }

    const data = await response.json();
    let reviews = data.reviews || [];

    // Filter by package if specified
    if (packageName) {
      reviews = reviews.filter(r => r.package_name === packageName);
    }

    // Calculate stats per package
    const stats = {};
    for (const review of data.reviews || []) {
      if (!stats[review.package_name]) {
        stats[review.package_name] = { count: 0, total: 0, avg: 0 };
      }
      stats[review.package_name].count++;
      if (review.rating) {
        stats[review.package_name].total += review.rating;
        stats[review.package_name].avg =
          stats[review.package_name].total / stats[review.package_name].count;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        reviews: reviews.slice(0, 50),  // Limit response size
        stats: packageName ? stats[packageName] : stats
      })
    };

  } catch (error) {
    console.error('Error fetching reviews:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch reviews' })
    };
  }
}

// Submit a new review
async function submitReview(event, headers) {
  // Check for GitHub token
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        error: 'Review system not configured',
        message: 'Reviews are temporarily unavailable. Please try again later.'
      })
    };
  }

  try {
    const body = JSON.parse(event.body);

    // Validate required fields
    if (!body.package_name || !body.comment) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Package name and comment are required' })
      };
    }

    // Sanitize and validate rating
    const rating = parseInt(body.rating);
    if (body.rating && (isNaN(rating) || rating < 1 || rating > 5)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Rating must be 1-5' })
      };
    }

    // Create review object
    const review = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      package_name: body.package_name.trim(),
      rating: rating || null,
      title: (body.title || '').trim().slice(0, 100),
      comment: body.comment.trim().slice(0, 1000),
      use_case: (body.use_case || '').trim().slice(0, 200),
      author: (body.author || 'Anonymous').trim().slice(0, 50),
      created_at: new Date().toISOString(),
      helpful_count: 0,
      verified: false
    };

    // Fetch existing reviews
    let existingData = { reviews: [] };
    let fileSha = null;

    try {
      const fileResponse = await fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${REVIEWS_PATH}`,
        {
          headers: {
            'Authorization': `token ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        }
      );

      if (fileResponse.ok) {
        const fileData = await fileResponse.json();
        fileSha = fileData.sha;
        const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
        existingData = JSON.parse(content);
      }
    } catch (e) {
      // File doesn't exist yet, that's OK
    }

    // Add new review
    existingData.reviews = existingData.reviews || [];
    existingData.reviews.unshift(review);  // Add to beginning
    existingData.updated_at = new Date().toISOString();

    // Keep only last 1000 reviews to prevent file from growing too large
    if (existingData.reviews.length > 1000) {
      existingData.reviews = existingData.reviews.slice(0, 1000);
    }

    // Write back to GitHub
    const updateResponse = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${REVIEWS_PATH}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `Add review for ${review.package_name}`,
          content: Buffer.from(JSON.stringify(existingData, null, 2)).toString('base64'),
          sha: fileSha
        })
      }
    );

    if (!updateResponse.ok) {
      const errorData = await updateResponse.json();
      console.error('GitHub API error:', errorData);
      throw new Error('Failed to save review');
    }

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        review: review
      })
    };

  } catch (error) {
    console.error('Error submitting review:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to submit review' })
    };
  }
}
