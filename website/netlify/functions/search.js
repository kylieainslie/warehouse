// search.js
// Netlify serverless function for AI-powered semantic search

const Anthropic = require('@anthropic-ai/sdk');

// System prompt for semantic search
const SEARCH_PROMPT = `You are a search engine for R packages. Given a user's search query, return the most relevant R package names.

Your task:
1. Understand what the user wants to DO (not just keyword matching)
2. Return package names that best accomplish that task
3. Order by relevance (most relevant first)

IMPORTANT: Return ONLY a JSON array of package names, nothing else. Example:
["EpiEstim", "incidence2", "epicontacts"]

If the query is about:
- "serial interval" or "reproduction number" → Include EpiEstim, epiparameter
- "epidemic curves" or "incidence" → Include incidence2, epicontacts
- "plotting" or "visualization" → Include ggplot2, plotly
- "data manipulation" → Include dplyr, tidyr, data.table
- "time series" → Include forecast, tseries
- "spatial analysis" → Include sf, terra, leaflet
- "web scraping" → Include rvest, httr2
- "machine learning" → Include tidymodels, caret, mlr3

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

    // Call Claude API for semantic search
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-20250514',
      max_tokens: 256,
      system: SEARCH_PROMPT,
      messages: [{
        role: 'user',
        content: `Search query: "${query.trim()}"`
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
