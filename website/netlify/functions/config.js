// config.js
// Centralized configuration for Netlify functions
// Update model versions here when new versions are released

module.exports = {
  // Claude model configuration
  // See: https://docs.anthropic.com/en/docs/about-claude/models
  models: {
    // Fast, cost-effective model for simple tasks (search, classification)
    fast: 'claude-3-5-haiku-20241022',

    // Balanced model for complex tasks (chat, analysis)
    balanced: 'claude-sonnet-4-20250514',

    // Most capable model for difficult tasks (if needed)
    powerful: 'claude-sonnet-4-20250514'
  },

  // Rate limiting defaults (requests per window)
  rateLimit: {
    search: { requests: 20, windowMs: 60000 },  // 20 per minute
    chat: { requests: 10, windowMs: 60000 }     // 10 per minute
  },

  // Response limits
  limits: {
    maxTokens: {
      search: 500,
      chat: 1024
    }
  }
};
