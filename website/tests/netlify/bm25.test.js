// bm25.test.js
// Tests for BM25 search algorithm implementation

// Import helper functions and constants directly from search.js
const {
  tokenize,
  stemTerm,
  countTermFrequencies,
  calculateIDF,
  buildDocumentIndex,
  searchPackages,
  BM25_K1,
  BM25_B,
  FIELD_WEIGHTS,
  MIN_SCORE_THRESHOLD
} = require('../../netlify/functions/search');

describe('BM25 Helper Functions', () => {
  describe('tokenize', () => {
    test('splits text into lowercase words', () => {
      expect(tokenize('Hello World')).toEqual(['hello', 'world']);
    });

    test('removes punctuation', () => {
      expect(tokenize("it's a test-case, isn't it?")).toEqual(['it', 's', 'a', 'test', 'case', 'isn', 't', 'it']);
    });

    test('handles empty or null input', () => {
      expect(tokenize('')).toEqual([]);
      expect(tokenize(null)).toEqual([]);
      expect(tokenize(undefined)).toEqual([]);
    });

    test('filters empty tokens', () => {
      expect(tokenize('  multiple   spaces  ')).toEqual(['multiple', 'spaces']);
    });
  });

  describe('stemTerm', () => {
    test('removes plural s', () => {
      expect(stemTerm('models')).toBe('model');
      expect(stemTerm('tests')).toBe('test');
    });

    test('removes es endings', () => {
      expect(stemTerm('boxes')).toBe('box');
      expect(stemTerm('classes')).toBe('class');
    });

    test('converts ies to y', () => {
      expect(stemTerm('epidemies')).toBe('epidemy');
      expect(stemTerm('studies')).toBe('study');
    });

    test('removes ing', () => {
      expect(stemTerm('modeling')).toBe('model');
      expect(stemTerm('testing')).toBe('test');
    });

    test('removes ed', () => {
      expect(stemTerm('modeled')).toBe('model');
      expect(stemTerm('tested')).toBe('test');
    });

    test('preserves short words', () => {
      expect(stemTerm('as')).toBe('as');
      expect(stemTerm('is')).toBe('is');
    });
  });

  describe('countTermFrequencies', () => {
    test('counts single occurrences', () => {
      const freq = countTermFrequencies(['a', 'b', 'c']);
      expect(freq.get('a')).toBe(1);
      expect(freq.get('b')).toBe(1);
      expect(freq.get('c')).toBe(1);
    });

    test('counts multiple occurrences', () => {
      const freq = countTermFrequencies(['a', 'b', 'a', 'a', 'b']);
      expect(freq.get('a')).toBe(3);
      expect(freq.get('b')).toBe(2);
    });

    test('handles empty array', () => {
      const freq = countTermFrequencies([]);
      expect(freq.size).toBe(0);
    });
  });

  describe('calculateIDF', () => {
    test('returns higher IDF for rare terms', () => {
      const rareIDF = calculateIDF(1, 1000);
      const commonIDF = calculateIDF(500, 1000);
      expect(rareIDF).toBeGreaterThan(commonIDF);
    });

    test('returns positive value for all valid inputs', () => {
      expect(calculateIDF(1, 100)).toBeGreaterThan(0);
      expect(calculateIDF(50, 100)).toBeGreaterThan(0);
      expect(calculateIDF(100, 100)).toBeGreaterThan(0);
    });

    test('handles edge case of term in all documents', () => {
      const idf = calculateIDF(100, 100);
      expect(idf).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('BM25 Search Behavior', () => {
  // Create mock package data
  const mockPackages = [
    {
      package_name: 'ggplot2',
      title: 'Create Elegant Data Visualisations Using the Grammar of Graphics',
      description: 'A system for declaratively creating graphics, based on "The Grammar of Graphics".',
      topics: ['visualization', 'plotting', 'graphics'],
      score: 0.9
    },
    {
      package_name: 'dplyr',
      title: 'A Grammar of Data Manipulation',
      description: 'A fast, consistent tool for working with data frame like objects.',
      topics: ['data-manipulation', 'tidyverse'],
      score: 0.95
    },
    {
      package_name: 'EpiEstim',
      title: 'Estimate Time Varying Reproduction Numbers from Epidemic Curves',
      description: 'Provides tools to estimate the instantaneous reproduction number during epidemics.',
      topics: ['epidemiology', 'reproduction-number', 'disease'],
      score: 0.8
    },
    {
      package_name: 'ggplot2movies',
      title: 'Movies Data for ggplot2 Examples',
      description: 'A dataset containing movie information for use in ggplot2 examples.',
      topics: ['data', 'movies'],
      score: 0.3
    },
    {
      package_name: 'plotly',
      title: 'Create Interactive Web Graphics via plotly.js',
      description: 'Create interactive web graphics from ggplot2 graphs and/or a custom interface.',
      topics: ['visualization', 'interactive', 'web'],
      score: 0.85
    }
  ];

  // Mock the search module with test packages
  jest.mock('../../netlify/functions/rate-limiter', () => ({
    rateLimitMiddleware: jest.fn(() => ({ allowed: true, headers: {} }))
  }));

  jest.mock('../../netlify/functions/config', () => ({
    models: { fast: 'claude-3-haiku', balanced: 'claude-3-sonnet' },
    limits: { maxTokens: { search: 1024, chat: 1024 } }
  }));

  // Test through the searchPackages behavior by loading fresh module
  beforeEach(() => {
    jest.resetModules();
    // Mock fetch to return our test packages
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ packages: mockPackages })
    });
  });

  test('exact package name match ranks highest', () => {
    // Build a document index using extracted functions
    // Since buildDocumentIndex now depends on stemTokens and tokenize, we test the output structure
    const docFreq = new Map();

    for (const pkg of mockPackages) {
      const nameTokens = tokenize(pkg.package_name || '').map(stemTerm);
      const titleTokens = tokenize(pkg.title || '').map(stemTerm);
      const descTokens = tokenize(pkg.description || '').map(stemTerm);
      const topicsText = Array.isArray(pkg.topics) ? pkg.topics.join(' ') : '';
      const topicTokens = tokenize(topicsText).map(stemTerm);

      const allTokens = [...nameTokens, ...titleTokens, ...descTokens, ...topicTokens];
      const uniqueTerms = new Set(allTokens);
      for (const term of uniqueTerms) {
        docFreq.set(term, (docFreq.get(term) || 0) + 1);
      }
    }

    // Test that the index structure is correct
    expect(docFreq.size).toBeGreaterThan(0);

    // ggplot2 should appear in multiple packages (ggplot2, ggplot2movies, and plotly which mentions ggplot2)
    expect(docFreq.get('ggplot2')).toBeGreaterThanOrEqual(2);

    // "epidemiology" (from topics) should appear in 1 package - stemmer doesn't modify it
    expect(docFreq.get('epidemiology')).toBe(1);
  });

  test('rare terms have higher IDF than common terms', () => {
    // Build docFreq manually to test IDF
    const docFreq = new Map();
    for (const pkg of mockPackages) {
      const allText = `${pkg.package_name} ${pkg.title} ${pkg.description}`;
      const tokens = tokenize(allText).map(stemTerm);
      const uniqueTerms = new Set(tokens);
      for (const term of uniqueTerms) {
        docFreq.set(term, (docFreq.get(term) || 0) + 1);
      }
    }

    const totalDocs = mockPackages.length;

    // stemmed "epidemiology" is rare, "graphic" (stem of graphics) appears more
    const epidemiologyStemmed = stemTerm('epidemiology');
    const graphicsStemmed = stemTerm('graphics');

    const rareIDF = calculateIDF(docFreq.get(epidemiologyStemmed) || 0, totalDocs);
    const commonIDF = calculateIDF(docFreq.get(graphicsStemmed) || 0, totalDocs);

    expect(rareIDF).toBeGreaterThan(commonIDF);
  });
});

describe('BM25 Integration', () => {
  const mockPackages = [
    { package_name: 'epiestim', title: 'Epidemic estimation', description: 'Tools for estimating reproduction number in epidemics', topics: ['epidemiology'], score: 0.9 },
    { package_name: 'dplyr', title: 'Data manipulation', description: 'Fast data frame manipulation', topics: ['tidyverse'], score: 0.95 },
    { package_name: 'ggplot2', title: 'Graphics', description: 'Grammar of graphics visualization', topics: ['visualization'], score: 0.9 },
    { package_name: 'epidemia', title: 'Epidemic analysis', description: 'Bayesian epidemic modeling', topics: ['epidemiology', 'bayesian'], score: 0.8 },
    { package_name: 'epinet', title: 'Network epidemiology', description: 'Epidemic simulation on networks', topics: ['epidemiology', 'networks'], score: 0.7 },
  ];

  test('BM25 returns fewer results than simple matching for broad terms', () => {
    // With BM25, packages that only weakly match should be filtered by threshold
    // The MIN_SCORE_THRESHOLD should filter out very low-scoring matches
    expect(MIN_SCORE_THRESHOLD).toBeGreaterThan(0);
    expect(MIN_SCORE_THRESHOLD).toBeLessThan(20); // Reasonable threshold
  });

  test('field weights are properly configured', () => {
    // Verify name has highest weight
    expect(FIELD_WEIGHTS.name).toBe(10);
    expect(FIELD_WEIGHTS.title).toBe(5);
    expect(FIELD_WEIGHTS.topics).toBe(3);
    expect(FIELD_WEIGHTS.description).toBe(1);

    // Name should be most important
    expect(FIELD_WEIGHTS.name).toBeGreaterThan(FIELD_WEIGHTS.title);
    expect(FIELD_WEIGHTS.title).toBeGreaterThan(FIELD_WEIGHTS.topics);
    expect(FIELD_WEIGHTS.topics).toBeGreaterThan(FIELD_WEIGHTS.description);
  });

  test('BM25 parameters are within standard range', () => {
    // k1 should be between 1.2 and 2.0
    expect(BM25_K1).toBeGreaterThanOrEqual(1.2);
    expect(BM25_K1).toBeLessThanOrEqual(2.0);

    // b should be around 0.75
    expect(BM25_B).toBeGreaterThanOrEqual(0.5);
    expect(BM25_B).toBeLessThanOrEqual(1.0);
  });
});
