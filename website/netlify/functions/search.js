// search.js
// Netlify serverless function for AI-powered semantic search
// Uses real package data from packages.json for accurate results

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { rateLimitMiddleware } = require('./rate-limiter');

// Cache for package data (loaded once per cold start)
let packagesCache = null;

// Query expansion: map abbreviations/synonyms to expanded terms
const QUERY_EXPANSIONS = {
  // AI/ML
  'llm': ['llm', 'large language model', 'chatgpt', 'gpt', 'openai', 'anthropic', 'ollama', 'chat'],
  'llms': ['llm', 'large language model', 'chatgpt', 'gpt', 'openai', 'anthropic', 'ollama', 'chat'],
  'ai': ['ai', 'artificial intelligence', 'machine learning', 'deep learning', 'neural'],
  'ml': ['ml', 'machine learning', 'predictive', 'classification', 'regression', 'caret', 'tidymodels'],
  'dl': ['dl', 'deep learning', 'neural network', 'torch', 'keras', 'tensorflow'],
  'nn': ['nn', 'neural network', 'deep learning', 'torch', 'keras'],
  'nlp': ['nlp', 'natural language', 'text mining', 'sentiment', 'tokenization', 'tidytext'],
  'cv': ['cv', 'cross validation', 'cross-validation', 'resampling', 'bootstrap'],
  'rf': ['rf', 'random forest', 'randomforest', 'ranger', 'decision tree'],
  'xgb': ['xgb', 'xgboost', 'gradient boosting', 'boosted trees', 'lightgbm'],
  'svm': ['svm', 'support vector machine', 'kernel', 'classification'],
  'pca': ['pca', 'principal component', 'dimensionality reduction', 'factor analysis'],
  'kmeans': ['kmeans', 'k-means', 'clustering', 'cluster analysis'],

  // Statistics
  'stats': ['statistics', 'statistical', 'regression', 'hypothesis', 'inference'],
  'ols': ['ols', 'ordinary least squares', 'linear regression', 'lm'],
  'gee': ['gee', 'generalized estimating equations', 'generalised estimating equations', 'marginal model', 'clustered data', 'longitudinal', 'geepack', 'working correlation', 'sandwich', 'cluster-robust', 'robust standard error', 'correlated data'],
  'glm': ['glm', 'generalized linear model', 'generalised linear model', 'logistic', 'poisson', 'binomial'],
  'gam': ['gam', 'generalized additive model', 'spline', 'smooth', 'mgcv'],
  'lmm': ['lmm', 'linear mixed model', 'mixed effects', 'random effects', 'lme4', 'nlme', 'multilevel'],
  'glmm': ['glmm', 'generalized linear mixed model', 'mixed effects', 'random effects', 'lme4'],
  'anova': ['anova', 'analysis of variance', 'aov', 'f-test'],
  'ancova': ['ancova', 'analysis of covariance'],
  'manova': ['manova', 'multivariate analysis of variance'],
  'sem': ['sem', 'structural equation', 'lavaan', 'path analysis', 'latent variable'],
  'irt': ['irt', 'item response theory', 'psychometric', 'mirt', 'ltm'],
  'cfa': ['cfa', 'confirmatory factor analysis', 'lavaan', 'factor'],
  'efa': ['efa', 'exploratory factor analysis', 'factor analysis', 'psych'],
  'roc': ['roc', 'receiver operating', 'auc', 'sensitivity', 'specificity', 'proc'],
  'ci': ['ci', 'confidence interval', 'standard error', 'bootstrap'],
  'mcmc': ['mcmc', 'markov chain monte carlo', 'bayesian', 'stan', 'jags', 'gibbs'],
  'hmc': ['hmc', 'hamiltonian monte carlo', 'stan', 'bayesian'],

  // Epidemiology/Biostatistics
  'epi': ['epidemiology', 'epidemic', 'outbreak', 'disease', 'transmission'],
  'rr': ['rr', 'relative risk', 'risk ratio', 'hazard ratio'],
  'or': ['or', 'odds ratio', 'logistic regression', 'case control'],
  'hr': ['hr', 'hazard ratio', 'survival', 'cox', 'proportional hazards'],
  'irr': ['irr', 'incidence rate ratio', 'poisson', 'rate'],
  'nnt': ['nnt', 'number needed to treat', 'treatment effect'],
  'r0': ['r0', 'basic reproduction number', 'reproductive number', 'transmission'],
  'rt': ['rt', 'effective reproduction number', 'reproductive number', 'epinow', 'epiestim'],
  've': ['ve', 'vaccine effectiveness', 'vaccine efficacy', 'immunization'],
  'pk': ['pk', 'pharmacokinetic', 'drug concentration', 'adme', 'nlmixr'],
  'pd': ['pd', 'pharmacodynamic', 'drug effect', 'dose response'],
  'pkpd': ['pkpd', 'pk/pd', 'pharmacokinetic', 'pharmacodynamic', 'nlmixr', 'mrgsolve'],
  'km': ['km', 'kaplan meier', 'kaplan-meier', 'survival curve', 'survfit'],
  'cox': ['cox', 'proportional hazards', 'survival', 'coxph', 'hazard'],
  'rct': ['rct', 'randomized controlled trial', 'clinical trial', 'randomization'],
  'itt': ['itt', 'intention to treat', 'intent to treat', 'clinical trial'],
  'gwas': ['gwas', 'genome wide association', 'snp', 'genetic association'],

  // Time series
  'ts': ['time series', 'forecast', 'temporal', 'arima'],
  'arima': ['arima', 'autoregressive', 'time series', 'forecast', 'sarima'],
  'var': ['var', 'vector autoregression', 'multivariate time series', 'vars'],
  'garch': ['garch', 'volatility', 'heteroskedasticity', 'rugarch', 'financial'],
  'ets': ['ets', 'exponential smoothing', 'forecast', 'state space'],

  // Spatial/Geographic
  'geo': ['geographic', 'spatial', 'gis', 'coordinate', 'map'],
  'gis': ['gis', 'geographic information', 'spatial', 'sf', 'terra', 'raster'],
  'crs': ['crs', 'coordinate reference system', 'projection', 'epsg', 'sf'],
  'osm': ['osm', 'openstreetmap', 'mapping', 'osmdata'],

  // Data manipulation
  'tables': ['table', 'data.table', 'tidytable', 'datatable', 'dataframe', 'data frame'],
  'table': ['table', 'data.table', 'tidytable', 'datatable', 'dataframe', 'data frame'],
  'dataframe': ['dataframe', 'data frame', 'data.table', 'tibble', 'table'],
  'dataframes': ['dataframe', 'data frame', 'data.table', 'tibble', 'table'],
  'etl': ['etl', 'extract transform load', 'data pipeline', 'data processing'],
  'regex': ['regex', 'regular expression', 'pattern matching', 'stringr', 'grep'],
  'json': ['json', 'jsonlite', 'parse', 'api', 'web'],
  'xml': ['xml', 'xml2', 'parse', 'html', 'rvest'],
  'csv': ['csv', 'read', 'write', 'readr', 'data.table', 'fread'],
  'xlsx': ['xlsx', 'excel', 'spreadsheet', 'readxl', 'openxlsx', 'writexl'],

  // Web/API
  'api': ['api', 'http', 'rest', 'request', 'httr', 'httr2', 'curl'],
  'db': ['database', 'sql', 'sqlite', 'postgres', 'mysql', 'dbi'],
  'sql': ['sql', 'database', 'query', 'dbi', 'dbplyr', 'duckdb'],
  'viz': ['visualization', 'plot', 'chart', 'graph', 'ggplot'],
  'html': ['html', 'web', 'scrape', 'rvest', 'xml2'],
  'pdf': ['pdf', 'document', 'pdftools', 'tabulizer', 'extract'],

  // Reporting/Documents
  'rmd': ['rmd', 'rmarkdown', 'markdown', 'knitr', 'report'],
  'qmd': ['qmd', 'quarto', 'markdown', 'report', 'document'],
  'latex': ['latex', 'tex', 'pdf', 'tinytex', 'typeset'],

  // Development
  'pkg': ['pkg', 'package', 'devtools', 'usethis', 'roxygen'],
  'ci': ['ci', 'continuous integration', 'github actions', 'testing'],
  'tdd': ['tdd', 'test driven', 'testthat', 'unit test'],
  'oop': ['oop', 'object oriented', 'r6', 's4', 'class'],

  // Frequency/contingency tables
  'frequency': ['frequency', 'freq', 'count', 'tabulate', 'tabyl', 'crosstab', 'contingency'],
  'crosstab': ['crosstab', 'cross tabulation', 'contingency', 'two-way table', 'frequency'],
  'contingency': ['contingency', 'crosstab', 'two-way', 'categorical', 'frequency table', 'vcd'],
  'mosaic': ['mosaic', 'mosaic plot', 'vcd', 'ggmosaic', 'categorical', 'contingency'],
  'categorical': ['categorical', 'factor', 'discrete', 'nominal', 'ordinal', 'contingency', 'frequency']
};

// Expand query terms using synonyms
function expandQueryTerms(terms) {
  const expanded = new Set(terms);
  for (const term of terms) {
    const expansions = QUERY_EXPANSIONS[term];
    if (expansions) {
      for (const exp of expansions) {
        expanded.add(exp);
      }
    }
  }
  return Array.from(expanded);
}

// Load packages.json from the site's data directory
function loadPackages() {
  if (packagesCache) return packagesCache;

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

// Simple text search to find candidate packages
function findCandidates(packages, query, limit = 200) {
  const queryLower = query.toLowerCase();
  const baseTerms = queryLower.split(/\s+/).filter(t => t.length > 1);
  const queryTerms = expandQueryTerms(baseTerms);

  // Helper: check if two strings match (either direction, min 2 chars)
  const fuzzyMatch = (a, b) => {
    if (a.length < 2 || b.length < 2) return false;
    return a.includes(b) || b.includes(a);
  };

  // Score each package based on query match
  const scored = packages.map(pkg => {
    const name = (pkg.package_name || '').toLowerCase();
    const title = (pkg.title || '').toLowerCase();
    const description = (pkg.description || '').toLowerCase();
    const topics = Array.isArray(pkg.topics)
      ? pkg.topics.flat().join(' ').toLowerCase()
      : '';

    let score = 0;

    // Exact name match
    if (name === queryLower) score += 100;
    // Name contains query or query contains name
    else if (fuzzyMatch(name, queryLower)) score += 50;

    // Check each query term against fields (both directions)
    for (const term of queryTerms) {
      // Check name - high value
      if (fuzzyMatch(name, term)) score += 25;

      // Check title words
      const titleWords = title.split(/\s+/);
      for (const word of titleWords) {
        if (fuzzyMatch(word, term)) {
          score += 15;
          break;
        }
      }

      // Check if term appears in full title
      if (title.includes(term)) score += 10;

      // Check description
      if (description.includes(term)) score += 5;

      // Check topics
      if (topics.includes(term) || fuzzyMatch(topics, term)) score += 12;
    }

    // Boost by quality score if available
    const quality = parseFloat(pkg.score);
    if (!isNaN(quality) && quality > 0) score += quality / 20;

    return { pkg, score };
  });

  // Return top candidates with score > 0
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.pkg);
}

// Format candidates for the AI prompt
function formatCandidatesForPrompt(candidates) {
  return candidates.map(pkg => {
    const name = pkg.package_name || 'unknown';
    const title = pkg.title || '';
    const topics = Array.isArray(pkg.topics)
      ? pkg.topics.flat().slice(0, 3).join(', ')
      : '';
    return `- ${name}: ${title}${topics ? ` [${topics}]` : ''}`;
  }).join('\n');
}

// System prompt for semantic search (now uses real data)
const SEARCH_PROMPT = `You are a search engine for R packages. You will be given a search query and a list of candidate packages from the database.

Your task:
1. Understand what the user wants to DO (the intent behind their query)
2. Select the packages from the candidates that best accomplish that task
3. Order by relevance (most relevant first)
4. You may also include well-known R packages not in the candidates if highly relevant

IMPORTANT: Return ONLY a JSON array of package names, nothing else. Example:
["ggplot2", "dplyr", "tidyr"]

Return 5-15 package names. Return ONLY the JSON array.`;

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

    // Load packages and find candidates using text search
    const packages = loadPackages();
    const candidates = findCandidates(packages, query.trim());

    // If no candidates found, let AI use general knowledge
    const candidatesText = candidates.length > 0
      ? `\n\nCandidate packages from the database:\n${formatCandidatesForPrompt(candidates)}`
      : '\n\nNo direct matches found in database. Use your knowledge of popular R packages.';

    // Call Claude API for semantic ranking
    const response = await anthropic.messages.create({
      model: config.models.fast,
      max_tokens: config.limits.maxTokens.search,
      system: SEARCH_PROMPT,
      messages: [{
        role: 'user',
        content: `Search query: "${query.trim()}"${candidatesText}`
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
        candidates_found: candidates.length,
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
