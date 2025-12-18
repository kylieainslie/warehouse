// chat.js
// Netlify serverless function to proxy Claude API requests

const Anthropic = require('@anthropic-ai/sdk');

// System prompt for the package recommendation assistant
const SYSTEM_PROMPT = `You are The Warehouse's R package assistant, helping users find the right R packages for their data analysis tasks.

Your knowledge base includes packages from:
- CRAN (Comprehensive R Archive Network)
- Bioconductor (bioinformatics packages)
- R-universe (including epiverse-trace, mrc-ide, reconverse for epidemiology)
- rOpenSci (peer-reviewed scientific packages)

When recommending packages:
1. Focus on the user's specific task or problem
2. Recommend 1-3 packages that best fit their needs
3. Explain WHY each package is suitable
4. Mention key functions they should look at
5. Note any prerequisites or related packages
6. If comparing packages, explain trade-offs honestly

Format your responses clearly:
- Use **bold** for package names
- Use \`code\` for function names
- Keep responses concise but informative
- Include links to documentation when helpful

If you don't know about a specific package or the question is outside R packages, say so honestly.`;

// Load package context (cached)
let packageContext = null;

async function loadPackageContext() {
  if (packageContext) return packageContext;

  try {
    // In production, this would read from the deployed data folder
    // For now, we'll include a summary in the prompt
    packageContext = {
      loaded: true,
      summary: "Package database includes epidemiology packages (EpiEstim, epiparameter, incidence2, etc.), tidyverse ecosystem, ggplot2 extensions, and many more."
    };
    return packageContext;
  } catch (error) {
    console.error('Failed to load package context:', error);
    return { loaded: false, summary: "" };
  }
}

// Main handler
exports.handler = async function(event, context) {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Chat service not configured',
        response: 'The chat assistant is not yet configured. Please set up your Anthropic API key in Netlify environment variables.'
      })
    };
  }

  try {
    // Initialize Anthropic client inside handler (env vars available here)
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const body = JSON.parse(event.body);
    const { message, history = [] } = body;

    if (!message || typeof message !== 'string') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Message is required' })
      };
    }

    // Load package context
    const pkgContext = await loadPackageContext();

    // Build messages array for Claude
    const messages = [];

    // Add conversation history (limit to last 10 exchanges)
    const recentHistory = history.slice(-20);
    for (const msg of recentHistory) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }
    }

    // Add current message if not already in history
    if (messages.length === 0 || messages[messages.length - 1].content !== message) {
      messages.push({
        role: 'user',
        content: message
      });
    }

    // Call Claude API
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: messages
    });

    // Extract response text
    const responseText = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        response: responseText,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens
        }
      })
    };

  } catch (error) {
    console.error('Chat function error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error status:', error.status);

    // Handle specific error types
    if (error.status === 401) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Invalid API key',
          response: 'The chat service has an authentication issue. Please check the API key configuration.'
        })
      };
    }

    if (error.status === 429) {
      return {
        statusCode: 429,
        body: JSON.stringify({
          error: 'Rate limited',
          response: 'Too many requests. Please wait a moment and try again.'
        })
      };
    }

    // Return more detailed error for debugging
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.name || 'Internal server error',
        response: 'Sorry, something went wrong. Please try again later.',
        debug: error.message
      })
    };
  }
};
