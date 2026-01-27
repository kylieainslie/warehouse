// reviews.test.js
// Tests for reviews.js sanitization and validation

const { sanitizeHtml } = require('../../netlify/functions/reviews');

describe('sanitizeHtml', () => {
  // Basic XSS prevention
  describe('XSS prevention', () => {
    test('escapes script tags', () => {
      const input = '<script>alert("xss")</script>';
      const output = sanitizeHtml(input);
      expect(output).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(output).not.toContain('<script>');
    });

    test('escapes img onerror attack', () => {
      const input = '<img src=x onerror="alert(1)">';
      const output = sanitizeHtml(input);
      expect(output).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
      expect(output).not.toContain('<img');
    });

    test('escapes javascript: protocol', () => {
      const input = '<a href="javascript:alert(1)">click</a>';
      const output = sanitizeHtml(input);
      expect(output).not.toContain('<a');
      expect(output).toContain('&lt;a');
    });

    test('escapes event handlers', () => {
      const input = '<div onmouseover="evil()">hover me</div>';
      const output = sanitizeHtml(input);
      // The key is that < and > are escaped, so browser won't parse as HTML
      expect(output).not.toContain('<div');
      expect(output).toContain('&lt;div');
      expect(output).toBe('&lt;div onmouseover=&quot;evil()&quot;&gt;hover me&lt;/div&gt;');
    });

    test('escapes nested script attempts', () => {
      const input = '<<script>script>alert(1)<</script>/script>';
      const output = sanitizeHtml(input);
      expect(output).not.toContain('<script>');
    });
  });

  // Character escaping
  describe('character escaping', () => {
    test('escapes less than sign', () => {
      expect(sanitizeHtml('<')).toBe('&lt;');
    });

    test('escapes greater than sign', () => {
      expect(sanitizeHtml('>')).toBe('&gt;');
    });

    test('escapes ampersand', () => {
      expect(sanitizeHtml('&')).toBe('&amp;');
    });

    test('escapes double quotes', () => {
      expect(sanitizeHtml('"')).toBe('&quot;');
    });

    test('escapes single quotes', () => {
      expect(sanitizeHtml("'")).toBe('&#039;');
    });

    test('escapes all special characters together', () => {
      const input = '<script>"test" & \'more\'</script>';
      const output = sanitizeHtml(input);
      expect(output).toBe('&lt;script&gt;&quot;test&quot; &amp; &#039;more&#039;&lt;/script&gt;');
    });
  });

  // Edge cases
  describe('edge cases', () => {
    test('returns empty string for null', () => {
      expect(sanitizeHtml(null)).toBe('');
    });

    test('returns empty string for undefined', () => {
      expect(sanitizeHtml(undefined)).toBe('');
    });

    test('returns empty string for empty string', () => {
      expect(sanitizeHtml('')).toBe('');
    });

    test('returns empty string for non-string types', () => {
      expect(sanitizeHtml(123)).toBe('');
      expect(sanitizeHtml({})).toBe('');
      expect(sanitizeHtml([])).toBe('');
    });

    test('preserves normal text unchanged', () => {
      const input = 'This is a normal review with no special characters';
      expect(sanitizeHtml(input)).toBe(input);
    });

    test('preserves newlines', () => {
      const input = 'Line 1\nLine 2\nLine 3';
      expect(sanitizeHtml(input)).toBe(input);
    });

    test('preserves unicode characters', () => {
      const input = 'Great package! 👍 Très bien! 日本語';
      expect(sanitizeHtml(input)).toBe(input);
    });

    test('handles very long strings', () => {
      const input = '<script>'.repeat(1000);
      const output = sanitizeHtml(input);
      expect(output).not.toContain('<script>');
      expect(output.length).toBe('&lt;script&gt;'.length * 1000);
    });
  });

  // Real-world review examples
  describe('real-world examples', () => {
    test('sanitizes review with HTML in comment', () => {
      const input = 'Great package! <b>Highly recommended</b> for data analysis.';
      const output = sanitizeHtml(input);
      expect(output).toBe('Great package! &lt;b&gt;Highly recommended&lt;/b&gt; for data analysis.');
    });

    test('sanitizes review with code example', () => {
      const input = 'Use it like: library(dplyr) %>% filter(x > 5)';
      const output = sanitizeHtml(input);
      // %>% becomes %&gt;% (only the > is escaped)
      expect(output).toBe('Use it like: library(dplyr) %&gt;% filter(x &gt; 5)');
    });

    test('sanitizes review with URL-like content', () => {
      const input = 'Check docs at https://example.com?foo=bar&baz=qux';
      const output = sanitizeHtml(input);
      expect(output).toBe('Check docs at https://example.com?foo=bar&amp;baz=qux');
    });

    test('sanitizes malicious author name', () => {
      const input = '<script>stealCookies()</script>';
      const output = sanitizeHtml(input);
      expect(output).not.toContain('<script>');
    });
  });
});
