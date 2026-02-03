// security.test.js
// Tests for CORS origin restrictions, input validation, and error sanitization

// Mock the Anthropic SDK (must use require inline since jest.mock is hoisted)
jest.mock(
  require('path').resolve(__dirname, '../../netlify/functions/node_modules/@anthropic-ai/sdk'),
  () => jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"packages":[],"terms":[]}' }],
        usage: { input_tokens: 10, output_tokens: 20 }
      })
    }
  })),
  { virtual: true }
);

// Mock rate limiter
jest.mock('../../netlify/functions/rate-limiter', () => ({
  rateLimitMiddleware: jest.fn(() => ({ allowed: true, headers: {} }))
}));

// Mock config
jest.mock('../../netlify/functions/config', () => ({
  models: { fast: 'claude-3-haiku', balanced: 'claude-3-sonnet' },
  limits: { maxTokens: { search: 1024, chat: 1024 } }
}));

// Mock fetch globally
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ packages: [] })
});

describe('CORS origin restrictions', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.GITHUB_TOKEN = 'test-token';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GITHUB_TOKEN;
  });

  describe('search.js', () => {
    const { handler } = require('../../netlify/functions/search');

    test('returns production origin for allowed origin', async () => {
      const event = {
        httpMethod: 'POST',
        headers: { origin: 'https://rwarehouse.netlify.app' },
        body: JSON.stringify({ query: 'test query' })
      };
      const result = await handler(event, {});
      expect(result.headers['Access-Control-Allow-Origin']).toBe('https://rwarehouse.netlify.app');
    });

    test('returns production origin for disallowed origin', async () => {
      const event = {
        httpMethod: 'POST',
        headers: { origin: 'https://evil-site.com' },
        body: JSON.stringify({ query: 'test query' })
      };
      const result = await handler(event, {});
      expect(result.headers['Access-Control-Allow-Origin']).toBe('https://rwarehouse.netlify.app');
    });

    test('allows localhost for development', async () => {
      const event = {
        httpMethod: 'POST',
        headers: { origin: 'http://localhost:8888' },
        body: JSON.stringify({ query: 'test query' })
      };
      const result = await handler(event, {});
      expect(result.headers['Access-Control-Allow-Origin']).toBe('http://localhost:8888');
    });

    test('does not return wildcard origin', async () => {
      const event = {
        httpMethod: 'POST',
        headers: { origin: 'https://example.com' },
        body: JSON.stringify({ query: 'test query' })
      };
      const result = await handler(event, {});
      expect(result.headers['Access-Control-Allow-Origin']).not.toBe('*');
    });

    test('OPTIONS preflight returns correct origin', async () => {
      const event = {
        httpMethod: 'OPTIONS',
        headers: { origin: 'https://rwarehouse.netlify.app' }
      };
      const result = await handler(event, {});
      expect(result.statusCode).toBe(204);
      expect(result.headers['Access-Control-Allow-Origin']).toBe('https://rwarehouse.netlify.app');
    });
  });

  describe('chat.js', () => {
    const { handler } = require('../../netlify/functions/chat');

    test('returns production origin for disallowed origin', async () => {
      const event = {
        httpMethod: 'POST',
        headers: { origin: 'https://evil-site.com' },
        body: JSON.stringify({ message: 'hello' })
      };
      const result = await handler(event, {});
      expect(result.headers['Access-Control-Allow-Origin']).toBe('https://rwarehouse.netlify.app');
    });

    test('does not return wildcard origin', async () => {
      const event = {
        httpMethod: 'POST',
        headers: { origin: 'https://example.com' },
        body: JSON.stringify({ message: 'hello' })
      };
      const result = await handler(event, {});
      expect(result.headers['Access-Control-Allow-Origin']).not.toBe('*');
    });
  });

  describe('reviews.js', () => {
    const { handler } = require('../../netlify/functions/reviews');

    test('returns production origin for disallowed origin', async () => {
      const event = {
        httpMethod: 'GET',
        headers: { origin: 'https://evil-site.com' },
        queryStringParameters: {}
      };
      const result = await handler(event, {});
      expect(result.headers['Access-Control-Allow-Origin']).toBe('https://rwarehouse.netlify.app');
    });

    test('does not return wildcard origin', async () => {
      const event = {
        httpMethod: 'GET',
        headers: { origin: 'https://example.com' },
        queryStringParameters: {}
      };
      const result = await handler(event, {});
      expect(result.headers['Access-Control-Allow-Origin']).not.toBe('*');
    });
  });
});

describe('Input validation', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe('search.js query length', () => {
    const { handler } = require('../../netlify/functions/search');

    test('rejects empty query', async () => {
      const event = {
        httpMethod: 'POST',
        headers: { origin: 'https://rwarehouse.netlify.app' },
        body: JSON.stringify({ query: '' })
      };
      const result = await handler(event, {});
      expect(result.statusCode).toBe(400);
    });

    test('rejects single character query', async () => {
      const event = {
        httpMethod: 'POST',
        headers: { origin: 'https://rwarehouse.netlify.app' },
        body: JSON.stringify({ query: 'a' })
      };
      const result = await handler(event, {});
      expect(result.statusCode).toBe(400);
    });

    test('rejects query over 500 characters', async () => {
      const event = {
        httpMethod: 'POST',
        headers: { origin: 'https://rwarehouse.netlify.app' },
        body: JSON.stringify({ query: 'a'.repeat(501) })
      };
      const result = await handler(event, {});
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('500');
    });

    test('accepts query at max length', async () => {
      const event = {
        httpMethod: 'POST',
        headers: { origin: 'https://rwarehouse.netlify.app' },
        body: JSON.stringify({ query: 'a'.repeat(500) })
      };
      const result = await handler(event, {});
      expect(result.statusCode).not.toBe(400);
    });
  });

  describe('chat.js message length', () => {
    const { handler } = require('../../netlify/functions/chat');

    test('rejects empty message', async () => {
      const event = {
        httpMethod: 'POST',
        headers: { origin: 'https://rwarehouse.netlify.app' },
        body: JSON.stringify({ message: '' })
      };
      const result = await handler(event, {});
      expect(result.statusCode).toBe(400);
    });

    test('rejects message over 1000 characters', async () => {
      const event = {
        httpMethod: 'POST',
        headers: { origin: 'https://rwarehouse.netlify.app' },
        body: JSON.stringify({ message: 'a'.repeat(1001) })
      };
      const result = await handler(event, {});
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('1000');
    });

    test('accepts message at max length', async () => {
      const event = {
        httpMethod: 'POST',
        headers: { origin: 'https://rwarehouse.netlify.app' },
        body: JSON.stringify({ message: 'a'.repeat(1000) })
      };
      const result = await handler(event, {});
      expect(result.statusCode).not.toBe(400);
    });
  });
});

describe('Error message sanitization', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe('search.js', () => {
    const { handler } = require('../../netlify/functions/search');

    test('does not expose debug info in error response', async () => {
      const event = {
        httpMethod: 'POST',
        headers: { origin: 'https://rwarehouse.netlify.app' },
        body: 'not valid json'
      };
      const result = await handler(event, {});
      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body).not.toHaveProperty('debug');
      expect(body.error).toBe('Search failed');
    });
  });

  describe('chat.js', () => {
    const { handler } = require('../../netlify/functions/chat');

    test('does not expose debug info in error response', async () => {
      const event = {
        httpMethod: 'POST',
        headers: { origin: 'https://rwarehouse.netlify.app' },
        body: 'not valid json'
      };
      const result = await handler(event, {});
      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body).not.toHaveProperty('debug');
    });

    test('does not reveal API key details in error', async () => {
      const event = {
        httpMethod: 'POST',
        headers: { origin: 'https://rwarehouse.netlify.app' },
        body: 'not valid json'
      };
      const result = await handler(event, {});
      const body = JSON.parse(result.body);
      expect(JSON.stringify(body)).not.toContain('test-key');
      expect(JSON.stringify(body)).not.toContain('ANTHROPIC_API_KEY');
    });
  });
});
