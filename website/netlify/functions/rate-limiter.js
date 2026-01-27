// rate-limiter.js
// Simple in-memory rate limiter for Netlify functions
// Note: Resets on cold starts, but provides basic protection against abuse

const config = require('./config');

// In-memory store for request counts
// Structure: { [ip]: { count: number, resetTime: number } }
const requestCounts = new Map();

// Clean up old entries periodically (every 100 requests)
let cleanupCounter = 0;
const CLEANUP_INTERVAL = 100;

function cleanup() {
  const now = Date.now();
  for (const [ip, data] of requestCounts.entries()) {
    if (now > data.resetTime) {
      requestCounts.delete(ip);
    }
  }
}

/**
 * Check if a request should be rate limited
 * @param {string} ip - Client IP address
 * @param {string} endpoint - Endpoint name ('search' or 'chat')
 * @returns {{ allowed: boolean, remaining: number, resetIn: number }}
 */
function checkRateLimit(ip, endpoint) {
  const limits = config.rateLimit[endpoint] || { requests: 10, windowMs: 60000 };
  const now = Date.now();
  const key = `${ip}:${endpoint}`;

  // Periodic cleanup
  cleanupCounter++;
  if (cleanupCounter >= CLEANUP_INTERVAL) {
    cleanupCounter = 0;
    cleanup();
  }

  // Get or create entry for this IP/endpoint
  let entry = requestCounts.get(key);

  if (!entry || now > entry.resetTime) {
    // First request or window expired - create new entry
    entry = {
      count: 1,
      resetTime: now + limits.windowMs
    };
    requestCounts.set(key, entry);

    return {
      allowed: true,
      remaining: limits.requests - 1,
      resetIn: Math.ceil(limits.windowMs / 1000)
    };
  }

  // Increment count
  entry.count++;

  if (entry.count > limits.requests) {
    // Rate limit exceeded
    const resetIn = Math.ceil((entry.resetTime - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetIn: resetIn
    };
  }

  // Request allowed
  return {
    allowed: true,
    remaining: limits.requests - entry.count,
    resetIn: Math.ceil((entry.resetTime - now) / 1000)
  };
}

/**
 * Get client IP from Netlify event
 * @param {object} event - Netlify function event
 * @returns {string} Client IP address
 */
function getClientIp(event) {
  // Netlify provides the client IP in headers
  return event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         event.headers['client-ip'] ||
         event.headers['x-real-ip'] ||
         'unknown';
}

/**
 * Create rate limit response headers
 * @param {object} result - Rate limit check result
 * @param {string} endpoint - Endpoint name
 * @returns {object} Headers object
 */
function rateLimitHeaders(result, endpoint) {
  const limits = config.rateLimit[endpoint] || { requests: 10, windowMs: 60000 };
  return {
    'X-RateLimit-Limit': String(limits.requests),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetIn),
    'Retry-After': result.allowed ? undefined : String(result.resetIn)
  };
}

/**
 * Rate limit middleware - returns error response if limited, null if allowed
 * @param {object} event - Netlify function event
 * @param {string} endpoint - Endpoint name ('search' or 'chat')
 * @param {object} baseHeaders - Base response headers
 * @returns {object|null} Error response if rate limited, null if allowed
 */
function rateLimitMiddleware(event, endpoint, baseHeaders = {}) {
  const ip = getClientIp(event);
  const result = checkRateLimit(ip, endpoint);
  const headers = { ...baseHeaders, ...rateLimitHeaders(result, endpoint) };

  // Remove undefined headers
  Object.keys(headers).forEach(key => {
    if (headers[key] === undefined) delete headers[key];
  });

  if (!result.allowed) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({
        error: 'Too many requests',
        message: `Rate limit exceeded. Please wait ${result.resetIn} seconds before trying again.`,
        retryAfter: result.resetIn
      })
    };
  }

  // Return headers to be merged with response
  return { allowed: true, headers };
}

module.exports = {
  checkRateLimit,
  getClientIp,
  rateLimitHeaders,
  rateLimitMiddleware
};
