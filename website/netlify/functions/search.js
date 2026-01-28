// search.js
// Netlify serverless function for AI-powered semantic search
// Uses Claude to understand query intent and match against all package names

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { rateLimitMiddleware } = require('./rate-limiter');

// Cache for package data (loaded once per cold start)
let packagesCache = null;
let packageNamesCache = null;

// Load packages.json from the site's data directory
function loadPackages() {
  if (packagesCache) return { packages: packagesCache, names: packageNamesCache };

  try {
    // In Netlify, the site root is available at process.cwd() during build
    // but we need to look in the published _site/data directory
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
        // Create a map of package names for quick lookup
        packageNamesCache = packagesCache.map(pkg => pkg.package_name).filter(Boolean);
        console.log(`Loaded ${packagesCache.length} packages from ${p}`);
        return { packages: packagesCache, names: packageNamesCache };
      }
    }

    console.warn('packages.json not found in any expected location');
    return { packages: [], names: [] };
  } catch (err) {
    console.error('Failed to load packages.json:', err.message);
    return { packages: [], names: [] };
  }
}

// Get package details by name
function getPackagesByNames(packages, names) {
  const nameSet = new Set(names.map(n => n.toLowerCase()));
  return packages.filter(pkg =>
    nameSet.has((pkg.package_name || '').toLowerCase())
  );
}

// System prompt for semantic search - receives ALL package names
const SEARCH_PROMPT = `You are an expert R package search engine. You will receive a search query and a complete list of all available R package names.

Your task:
1. Understand what the user wants to DO (the intent behind their query)
2. Use your knowledge of R packages to identify which packages accomplish that task
3. Match packages from the provided list that are relevant
4. Order by relevance (most relevant first)

IMPORTANT GUIDELINES:
- Understand abbreviations: GEE = generalized estimating equations, GLM = generalized linear models, LMM = linear mixed models, etc.
- Think about what methods/functions each package provides, not just its name
- Include packages that implement the methodology even if the package name doesn't contain the search term
- For statistical methods, include both specialized packages AND general packages that provide the functionality

Return ONLY a JSON array of package names from the provided list. Example:
["ggplot2", "dplyr", "tidyr"]

Return 10-20 relevant package names. Return ONLY the JSON array.`;

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

    // Load all packages and their names
    const { packages, names } = loadPackages();

    if (names.length === 0) {
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

    console.log(`Sending ${names.length} package names to Claude for query: "${query.trim()}"`);

    // Send ALL package names to Claude for semantic matching
    // Names are compact (~200KB for 23k packages) so this is feasible
    const packageListText = names.join(', ');

    // Call Claude API for semantic search
    const response = await anthropic.messages.create({
      model: config.models.fast,
      max_tokens: config.limits.maxTokens.search,
      system: SEARCH_PROMPT,
      messages: [{
        role: 'user',
        content: `Search query: "${query.trim()}"\n\nAvailable R packages:\n${packageListText}`
      }]
    });

    // Extract response text
    const responseText = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    // Parse JSON array from response
    let packageNames = [];
    try {
      // Try to extract JSON array from response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        packageNames = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', responseText);
      packageNames = [];
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        packages: packageNames,
        query: query.trim(),
        total_packages: names.length,
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
