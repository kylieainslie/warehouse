// search.js
// Netlify serverless function for AI-powered semantic search
// Uses Claude to expand queries, then searches package metadata

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { rateLimitMiddleware } = require('./rate-limiter');

// Cache for package data (loaded once per cold start)
let packagesCache = null;

// Load packages.json from the site's data directory
function loadPackages() {
  if (packagesCache) return packagesCache;

  try {
    const possiblePaths = [
      path.join(process.cwd(), '_site', 'data', 'packages.json'),
      path.join(process.cwd(), 'data', 'packages.json'),
      path.join(__dirname, '..', '..', 'data', 'packages.json'),
      path.join(__dirname, '..', '..', '_site', 'data', 'packages.json')
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        packagesCache = data.packages || data;
        console.log(`Loaded ${packagesCache.length} packages from ${p}`);
        return packagesCache;
      }
    }

    console.warn('packages.json not found in any expected location');
    return [];
  } catch (err) {
    console.error('Failed to load packages.json:', err.message);
    return [];
  }
}

// Search packages using expanded terms
function searchPackages(packages, searchTerms, limit = 50) {
  const terms = searchTerms.map(t => t.toLowerCase());

  const scored = packages.map(pkg => {
    const name = (pkg.package_name || '').toLowerCase();
    const title = (pkg.title || '').toLowerCase();
    const description = (pkg.description || '').toLowerCase();
    const topics = Array.isArray(pkg.topics) ? pkg.topics.flat().join(' ').toLowerCase() : '';
    const allText = `${name} ${title} ${description} ${topics}`;

    let score = 0;
    for (const term of terms) {
      // Exact name match - highest priority
      if (name === term) score += 100;
      // Name contains term
      else if (name.includes(term)) score += 40;
      // Title contains term
      if (title.includes(term)) score += 25;
      // Description contains term
      if (description.includes(term)) score += 10;
      // Topics contain term
      if (topics.includes(term)) score += 20;
    }

    // Boost by quality score
    const quality = parseFloat(pkg.score);
    if (!isNaN(quality) && quality > 0) score += quality / 10;

    return { pkg, score };
  });

  return scored
    .filter(s => s.score > 0)
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

// Main handler
exports.handler = async function(event, context) {
  // CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
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

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Query is required', packages: [] })
      };
    }

    // Load all packages
    const packages = loadPackages();

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
    console.log(`Search terms: ${searchTerms.join(', ')}`);

    // Search database using Claude's suggested terms + original query
    const allTerms = [query.trim(), ...searchTerms];
    const dbMatches = searchPackages(packages, allTerms, 30);

    // Combine: Claude's suggestions first (if they exist in our DB), then DB matches
    const packageSet = new Set();
    const finalResults = [];

    // Add Claude's suggestions that exist in our database
    for (const name of aiPackages) {
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
      if (!packageSet.has(name)) {
        packageSet.add(name);
        finalResults.push(name);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        packages: finalResults.slice(0, 20),
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
        packages: [],
        debug: error.message
      })
    };
  }
};
