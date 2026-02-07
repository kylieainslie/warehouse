// search.js
// Netlify serverless function for AI-powered semantic search
// Uses Claude to expand queries, then searches package metadata

const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const { rateLimitMiddleware } = require('./rate-limiter');

// Cache for package data (loaded once per cold start)
let packagesCache = null;
// Cache for document index (computed once per cold start)
let docIndexCache = null;

/**
 * Load the package search index from the deployed site.
 * Results are cached in memory for the lifetime of the function instance.
 * @returns {Promise<Array<Object>>} Array of package objects
 */
async function loadPackages() {
  if (packagesCache) return packagesCache;

  try {
    // Fetch from the deployed site - use lightweight search index
    const siteUrl = process.env.URL || 'https://rwarehouse.netlify.app';
    const response = await fetch(`${siteUrl}/data/packages-search.json`);

    if (!response.ok) {
      throw new Error(`Failed to fetch packages: ${response.status}`);
    }

    const data = await response.json();
    packagesCache = data.packages || data;
    console.log(`Loaded ${packagesCache.length} packages from ${siteUrl}`);
    return packagesCache;
  } catch (err) {
    console.error('Failed to load packages:', err.message);
    return [];
  }
}

// Words ending in -ing that should not be stemmed (not verb forms)
const STEM_EXCEPTIONS = new Set([
  // Common nouns
  'string', 'ring', 'thing', 'something', 'nothing', 'everything', 'anything',
  'king', 'spring', 'swing', 'bring', 'bling', 'sting', 'fling', 'wing',
  'cling', 'sling', 'wring', 'offspring', 'underlying', 'during',
  // Technical/domain terms
  'warning', 'ceiling', 'lightning', 'sibling', 'building', 'ping',
  // Package names that are nouns
  'starling', 'viking', 'keyring', 'pudding', 'sterling'
]);

/**
 * Apply basic stemming by removing common English suffixes.
 * @param {string} term - Lowercase search term to stem
 * @returns {string} Stemmed term
 */
function stemTerm(term) {
  const t = term.toLowerCase();
  // Check exception list for words that shouldn't be stemmed
  if (STEM_EXCEPTIONS.has(t)) return t;
  // Remove trailing 's', 'es', 'ing', 'ed' for basic matching
  if (t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.endsWith('es') && t.length > 3) return t.slice(0, -2);
  if (t.endsWith('s') && t.length > 2) return t.slice(0, -1);
  if (t.endsWith('ing') && t.length > 5) return t.slice(0, -3);
  if (t.endsWith('ed') && t.length > 4) return t.slice(0, -2);
  return t;
}

// BM25 parameters
const BM25_K1 = 1.2;  // Term frequency saturation (1.2-2.0 typical)
const BM25_B = 0.75;  // Document length normalization (0.75 typical)

// Field weights for BM25 scoring
const FIELD_WEIGHTS = {
  name: 10.0,      // Package name matches are most important
  title: 5.0,      // Title is highly relevant
  topics: 3.0,     // Topics indicate functionality
  description: 1.0 // Description provides context
};

// Minimum BM25 score threshold for inclusion in results
// Higher threshold = fewer but more relevant results
// With field weights (name:10, title:5, topics:3, desc:1), a score of 3.0
// means at least a moderate match in title or multiple matches in description
const MIN_SCORE_THRESHOLD = 3.0;

/**
 * Tokenize text into lowercase words for BM25 scoring.
 * @param {string} text - Text to tokenize
 * @returns {string[]} Array of lowercase word tokens
 */
function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0);
}

/**
 * Count term frequencies in a token array.
 * @param {string[]} tokens - Array of tokens
 * @returns {Map<string, number>} Map of term to frequency count
 */
function countTermFrequencies(tokens) {
  const freq = new Map();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) || 0) + 1);
  }
  return freq;
}

/**
 * Stem all tokens in an array.
 * @param {string[]} tokens - Array of tokens to stem
 * @returns {string[]} Array of stemmed tokens
 */
function stemTokens(tokens) {
  return tokens.map(stemTerm);
}

/**
 * Build document frequency index for IDF calculation.
 * Computes per-field average lengths for proper BM25F normalization.
 * @param {Array<Object>} packages - Array of package objects
 * @returns {{docFreq: Map<string, number>, avgFieldLengths: Object, totalDocs: number}}
 */
function buildDocumentIndex(packages) {
  const docFreq = new Map();
  const fieldLengths = { name: 0, title: 0, description: 0, topics: 0 };

  for (const pkg of packages) {
    const name = (pkg.package_name || '').toLowerCase();
    const title = (pkg.title || '').toLowerCase();
    const description = (pkg.description || '').toLowerCase();
    const topics = Array.isArray(pkg.topics) ? pkg.topics.flat().join(' ').toLowerCase() : '';

    // Track per-field lengths for BM25F normalization
    const nameTokens = stemTokens(tokenize(name));
    const titleTokens = stemTokens(tokenize(title));
    const descTokens = stemTokens(tokenize(description));
    const topicTokens = stemTokens(tokenize(topics));

    fieldLengths.name += nameTokens.length;
    fieldLengths.title += titleTokens.length;
    fieldLengths.description += descTokens.length;
    fieldLengths.topics += topicTokens.length;

    // Collect unique stemmed terms for document frequency
    const allTokens = [...nameTokens, ...titleTokens, ...descTokens, ...topicTokens];
    const uniqueTerms = new Set(allTokens);

    // Increment document frequency once per unique term per document
    for (const term of uniqueTerms) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }

  const n = packages.length || 1;
  return {
    docFreq,
    avgFieldLengths: {
      name: fieldLengths.name / n,
      title: fieldLengths.title / n,
      description: fieldLengths.description / n,
      topics: fieldLengths.topics / n
    },
    totalDocs: packages.length
  };
}

/**
 * Calculate BM25 IDF (Inverse Document Frequency) for a term.
 * Uses the Robertson-Sparck Jones IDF formula with smoothing.
 * @param {number} docFreq - Number of documents containing the term
 * @param {number} totalDocs - Total number of documents
 * @returns {number} IDF score
 */
function calculateIDF(docFreq, totalDocs) {
  // BM25 IDF formula with smoothing to avoid negative values
  return Math.log(1 + (totalDocs - docFreq + 0.5) / (docFreq + 0.5));
}

/**
 * Calculate BM25 score for a single field.
 * @param {string[]} fieldTokens - Stemmed tokens from the field
 * @param {string[]} queryTerms - Stemmed query terms to match
 * @param {Map<string, number>} docFreqMap - Document frequency for each term
 * @param {number} totalDocs - Total number of documents
 * @param {number} avgFieldLength - Average length for this specific field
 * @param {number} fieldWeight - Weight multiplier for this field
 * @returns {number} BM25 score for this field
 */
function calculateFieldBM25(fieldTokens, queryTerms, docFreqMap, totalDocs, avgFieldLength, fieldWeight) {
  if (fieldTokens.length === 0) return 0;

  const termFreq = countTermFrequencies(fieldTokens);
  const docLength = fieldTokens.length;
  // Use at least 1 for avgFieldLength to avoid division issues
  const avgLen = avgFieldLength > 0 ? avgFieldLength : 1;
  let score = 0;

  for (const term of queryTerms) {
    const tf = termFreq.get(term) || 0;
    if (tf === 0) continue;

    const df = docFreqMap.get(term) || 0;
    const idf = calculateIDF(df, totalDocs);

    // BM25 term frequency saturation formula
    const tfSaturated = (tf * (BM25_K1 + 1)) /
      (tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / avgLen)));

    score += idf * tfSaturated;
  }

  return score * fieldWeight;
}

/**
 * Score and rank packages using BM25 algorithm.
 * BM25 provides better relevance ranking than simple term matching by
 * considering term frequency saturation, inverse document frequency,
 * and document length normalization.
 * @param {Array<Object>} packages - Array of package objects to search
 * @param {string[]} searchTerms - Terms to match against package metadata
 * @param {number} [limit=50] - Maximum number of results to return
 * @returns {string[]} Ranked array of matching package names
 */
function searchPackages(packages, searchTerms, limit = 50) {
  // Build document index for IDF calculation (cached across warm invocations)
  if (!docIndexCache || docIndexCache.totalDocs !== packages.length) {
    docIndexCache = buildDocumentIndex(packages);
  }
  const { docFreq, avgFieldLengths, totalDocs } = docIndexCache;

  // Prepare stemmed query terms for consistent matching with IDF
  const queryTerms = [];
  const rawQueryTerms = []; // Preserve untokenized terms for exact-name matching
  for (const t of searchTerms) {
    const lower = t.toLowerCase();
    rawQueryTerms.push(lower); // Keep original for exact match (e.g., "data.table")
    const tokens = tokenize(lower);
    for (const token of tokens) {
      // Only add stemmed versions - matches how IDF was computed
      queryTerms.push(stemTerm(token));
    }
  }

  // Remove duplicate terms
  const uniqueQueryTerms = [...new Set(queryTerms)];
  const uniqueRawTerms = [...new Set(rawQueryTerms)];

  const scored = packages.map(pkg => {
    const name = (pkg.package_name || '').toLowerCase();
    const title = (pkg.title || '').toLowerCase();
    const description = (pkg.description || '').toLowerCase();
    const topics = Array.isArray(pkg.topics) ? pkg.topics.flat().join(' ').toLowerCase() : '';

    // Tokenize and stem each field (matches how IDF was computed)
    const nameTokens = stemTokens(tokenize(name));
    const titleTokens = stemTokens(tokenize(title));
    const descTokens = stemTokens(tokenize(description));
    const topicTokens = stemTokens(tokenize(topics));

    // Calculate BM25 score for each field with per-field average lengths
    let score = 0;
    score += calculateFieldBM25(nameTokens, uniqueQueryTerms, docFreq, totalDocs, avgFieldLengths.name, FIELD_WEIGHTS.name);
    score += calculateFieldBM25(titleTokens, uniqueQueryTerms, docFreq, totalDocs, avgFieldLengths.title, FIELD_WEIGHTS.title);
    score += calculateFieldBM25(descTokens, uniqueQueryTerms, docFreq, totalDocs, avgFieldLengths.description, FIELD_WEIGHTS.description);
    score += calculateFieldBM25(topicTokens, uniqueQueryTerms, docFreq, totalDocs, avgFieldLengths.topics, FIELD_WEIGHTS.topics);

    // Bonus for exact package name match (important for direct lookups)
    // Use raw terms to match dotted names like "data.table"
    for (const term of uniqueRawTerms) {
      if (name === term) {
        score += 50; // Strong boost for exact name match
        break;
      }
    }

    // Small boost from package quality score (clamped to 0-1 range)
    const quality = Math.max(0, Math.min(1, parseFloat(pkg.score) || 0));
    if (quality > 0) {
      score += quality * 0.1;
    }

    return { pkg, score };
  });

  return scored
    .filter(s => s.score >= MIN_SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.pkg.package_name);
}

// System prompt - Claude recommends packages based on its knowledge
const SEARCH_PROMPT = `You are an expert R programmer. A user wants to find R packages for a specific task.

Based on your knowledge of R packages, suggest packages that can accomplish their goal. Think about:
- What methodology or functionality they need
- Which R packages implement that functionality
- Both specialized packages AND general-purpose packages that include the feature

Return a JSON object with:
- "packages": array of R package names (most relevant first, up to 20)
- "terms": array of search keywords to find more packages (method names, synonyms, related concepts)

Example for "gee":
{
  "packages": ["geepack", "gee", "geeM", "multgee", "sandwich", "clubSandwich", "lme4", "nlme"],
  "terms": ["generalized estimating equations", "marginal model", "clustered data", "longitudinal", "robust standard error", "working correlation"]
}

Return ONLY the JSON object.`;

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://rwarehouse.netlify.app',
  'http://localhost:8888',
  'http://localhost:3000'
];

/**
 * Resolve the CORS origin from the request against the allowlist.
 * Returns the production origin for unrecognized origins.
 * @param {Object} event - Netlify function event
 * @returns {string} Allowed origin URL
 */
function getCorsOrigin(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

/**
 * Netlify handler for AI-powered package search.
 * Accepts a POST with { query } and returns ranked package names using
 * Claude for query expansion combined with local text matching.
 * @param {Object} event - Netlify function event
 * @param {Object} context - Netlify function context
 * @returns {Promise<Object>} HTTP response with matched packages
 */
exports.handler = async function(event, context) {
  // CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': getCorsOrigin(event),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Check rate limit
  const rateLimit = rateLimitMiddleware(event, 'search', headers);
  if (!rateLimit.allowed) {
    return rateLimit; // Returns 429 response
  }
  // Merge rate limit headers
  Object.assign(headers, rateLimit.headers);

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        error: 'Search service not configured',
        packages: []
      })
    };
  }

  try {
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const body = JSON.parse(event.body);
    const { query } = body;

    const MAX_QUERY_LENGTH = 500;
    if (!query || typeof query !== 'string' || query.trim().length < 2 || query.trim().length > MAX_QUERY_LENGTH) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Query must be between 2 and 500 characters', packages: [] })
      };
    }

    // Load all packages
    const packages = await loadPackages();

    if (packages.length === 0) {
      console.error('No packages loaded - check data file paths');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Package data not available',
          packages: []
        })
      };
    }

    console.log(`Processing search query: "${query.trim()}"`);

    // Ask Claude what packages can do this task
    const response = await anthropic.messages.create({
      model: config.models.fast,
      max_tokens: config.limits.maxTokens.search,
      system: SEARCH_PROMPT,
      messages: [{
        role: 'user',
        content: `Find R packages that can: ${query.trim()}`
      }]
    });

    // Extract response text
    const responseText = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    // Parse JSON response
    let aiPackages = [];
    let searchTerms = [];
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        aiPackages = parsed.packages || [];
        searchTerms = parsed.terms || [];
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', responseText);
    }

    console.log(`Claude suggested: ${aiPackages.join(', ')}`);
    console.log(`Claude search terms: ${searchTerms.join(', ')}`);

    // Filter search terms to only the most specific ones using IDF
    // Build document index if not cached
    if (!docIndexCache || docIndexCache.totalDocs !== packages.length) {
      docIndexCache = buildDocumentIndex(packages);
    }
    const { docFreq, totalDocs } = docIndexCache;

    // Score each search term by average IDF of its tokens (higher = more specific)
    const scoredTerms = searchTerms.map(term => {
      const tokens = stemTokens(tokenize(term.toLowerCase()));
      if (tokens.length === 0) return { term, score: 0 };

      let totalIDF = 0;
      for (const token of tokens) {
        const df = docFreq.get(token) || 0;
        totalIDF += calculateIDF(df, totalDocs);
      }
      // Average IDF per token - penalizes overly broad multi-word terms
      return { term, score: totalIDF / tokens.length };
    });

    // Sort by specificity (highest IDF first) and take top 5 most specific terms
    const MAX_SEARCH_TERMS = 5;
    const MIN_IDF_THRESHOLD = 1.0; // Filter out very common terms
    const filteredTerms = scoredTerms
      .filter(t => t.score >= MIN_IDF_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SEARCH_TERMS)
      .map(t => t.term);

    console.log(`Filtered to ${filteredTerms.length} specific terms: ${filteredTerms.join(', ')}`);

    // Check if query is an exact package name match
    const queryLower = query.trim().toLowerCase();
    const exactMatch = packages.find(p => p.package_name.toLowerCase() === queryLower);

    // If exact match found, return just that package
    // No need to add AI suggestions or DB matches for direct package lookups
    if (exactMatch) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          packages: [exactMatch.package_name],
          query: query.trim(),
          ai_suggestions: aiPackages.length,
          db_matches: 0,
          exact_match: true,
          usage: {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens
          }
        })
      };
    }

    // For non-exact matches, search database and combine results
    const MAX_RESULTS = 100;
    const allTerms = [query.trim(), ...filteredTerms];
    const dbMatches = searchPackages(packages, allTerms, MAX_RESULTS);

    // Combine: Claude's suggestions first, then DB matches
    const packageSet = new Set();
    const finalResults = [];

    // Add Claude's suggestions that exist in our database
    for (const name of aiPackages) {
      if (finalResults.length >= MAX_RESULTS) break;
      const found = packages.find(p =>
        p.package_name.toLowerCase() === name.toLowerCase()
      );
      if (found && !packageSet.has(found.package_name)) {
        packageSet.add(found.package_name);
        finalResults.push(found.package_name);
      }
    }

    // Add database search results
    for (const name of dbMatches) {
      if (finalResults.length >= MAX_RESULTS) break;
      if (!packageSet.has(name)) {
        packageSet.add(name);
        finalResults.push(name);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        packages: finalResults,
        query: query.trim(),
        ai_suggestions: aiPackages.length,
        db_matches: dbMatches.length,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens
        }
      })
    };

  } catch (error) {
    console.error('Search function error:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Search failed',
        packages: []
      })
    };
  }
};

// Export helper functions and constants for testing
module.exports.tokenize = tokenize;
module.exports.stemTerm = stemTerm;
module.exports.stemTokens = stemTokens;
module.exports.countTermFrequencies = countTermFrequencies;
module.exports.calculateIDF = calculateIDF;
module.exports.buildDocumentIndex = buildDocumentIndex;
module.exports.calculateFieldBM25 = calculateFieldBM25;
module.exports.searchPackages = searchPackages;
module.exports.BM25_K1 = BM25_K1;
module.exports.BM25_B = BM25_B;
module.exports.FIELD_WEIGHTS = FIELD_WEIGHTS;
module.exports.MIN_SCORE_THRESHOLD = MIN_SCORE_THRESHOLD;
