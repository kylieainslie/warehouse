/**
 * Audit logging for Netlify functions
 *
 * Writes one structured JSON line per request to the function logs, so usage
 * and abuse patterns (who is calling, how often, how many tokens) can be traced
 * in Netlify's dashboard. Deliberately does NOT log query or message text, and
 * identifies clients by a salted hash rather than their IP address.
 */

const crypto = require('crypto');
const { getClientIp } = require('./rate-limiter');

/**
 * Hash a client IP so repeat callers can be grouped without storing the IP.
 * The salt includes the date, so hashes can't be linked across days.
 * Set AUDIT_LOG_SALT in Netlify to stop hashes being reversed by brute force.
 * @param {string} ip - Client IP address
 * @param {Date} now - Current time
 * @returns {string} 12-character hex hash
 */
function hashClient(ip, now = new Date()) {
  const salt = `${process.env.AUDIT_LOG_SALT || ''}:${now.toISOString().slice(0, 10)}`;
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 12);
}

/**
 * Safely parse a JSON string, returning null on failure
 * @param {string} text - JSON text
 * @returns {object|null} Parsed object or null
 */
function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/**
 * Classify a status code into an outcome label
 * @param {number} statusCode - HTTP status code
 * @returns {string} Outcome label
 */
function outcomeFor(statusCode) {
  if (statusCode === 429) return 'rate_limited';
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'rejected';
  return 'success';
}

/**
 * Build the audit record for one request
 * @param {string} endpoint - Endpoint name
 * @param {object} event - Netlify function event
 * @param {object} response - Handler response ({ statusCode, body })
 * @param {number} durationMs - Time taken by the handler
 * @returns {object} Audit record
 */
function buildRecord(endpoint, event, response, durationMs) {
  const request = parseJson(event.body) || {};
  const result = parseJson(response.body) || {};
  const input = request.message ?? request.query;

  const record = {
    audit: true,
    timestamp: new Date().toISOString(),
    endpoint,
    method: event.httpMethod,
    status: response.statusCode,
    outcome: outcomeFor(response.statusCode),
    duration_ms: durationMs,
    client: hashClient(getClientIp(event))
  };

  if (typeof input === 'string') record.input_length = input.length;
  if (Array.isArray(request.history)) record.history_length = request.history.length;
  if (result.usage) {
    record.input_tokens = result.usage.input_tokens;
    record.output_tokens = result.usage.output_tokens;
  }
  if (result.exact_match) record.exact_match = true;

  return record;
}

/**
 * Wrap a Netlify function handler so every request is audit-logged.
 * CORS preflight (OPTIONS) requests are not logged.
 * @param {string} endpoint - Endpoint name used in the log
 * @param {Function} handler - The original async handler
 * @returns {Function} Wrapped handler
 */
function withAuditLog(endpoint, handler) {
  return async function(event, context) {
    if (event.httpMethod === 'OPTIONS') return handler(event, context);

    const start = Date.now();
    let response;
    try {
      response = await handler(event, context);
      return response;
    } catch (error) {
      response = { statusCode: 500, body: '' };
      throw error;
    } finally {
      try {
        console.log(JSON.stringify(buildRecord(endpoint, event, response, Date.now() - start)));
      } catch {
        // Logging must never break a request
      }
    }
  };
}

module.exports = {
  withAuditLog,
  buildRecord,
  hashClient
};
