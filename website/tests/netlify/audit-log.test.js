// audit-log.test.js
// Tests for structured audit logging in Netlify functions

const { withAuditLog, buildRecord, hashClient } = require('../../netlify/functions/audit-log');

const IP = '203.0.113.7';
const QUERY = 'secret research topic about rare disease';

function makeEvent(body, method = 'POST') {
  return {
    httpMethod: method,
    headers: { 'x-forwarded-for': IP },
    body: body === undefined ? undefined : JSON.stringify(body)
  };
}

function okResponse(body) {
  return { statusCode: 200, body: JSON.stringify(body) };
}

let logSpy;

beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  delete process.env.AUDIT_LOG_SALT;
});

function loggedRecords() {
  return logSpy.mock.calls.map(([line]) => JSON.parse(line));
}

// ==============================================================================
// buildRecord()
// ==============================================================================

describe('buildRecord', () => {
  test('records endpoint, status, tokens and input length', () => {
    const record = buildRecord(
      'search',
      makeEvent({ query: QUERY }),
      okResponse({ packages: [], usage: { input_tokens: 300, output_tokens: 250 } }),
      42
    );

    expect(record).toMatchObject({
      audit: true,
      endpoint: 'search',
      method: 'POST',
      status: 200,
      outcome: 'success',
      duration_ms: 42,
      input_length: QUERY.length,
      input_tokens: 300,
      output_tokens: 250
    });
  });

  test('never includes query text or the client IP', () => {
    const record = buildRecord(
      'search',
      makeEvent({ query: QUERY }),
      okResponse({ query: QUERY, packages: ['survival'] }),
      5
    );
    const line = JSON.stringify(record);

    expect(line).not.toContain('rare disease');
    expect(line).not.toContain(IP);
    expect(record.client).toMatch(/^[0-9a-f]{12}$/);
  });

  test('records chat history length', () => {
    const record = buildRecord(
      'chat',
      makeEvent({ message: 'hi', history: [{}, {}, {}] }),
      okResponse({ response: 'hello' }),
      5
    );

    expect(record.input_length).toBe(2);
    expect(record.history_length).toBe(3);
  });

  test('flags exact-match searches that skip the AI call', () => {
    const record = buildRecord(
      'search',
      makeEvent({ query: 'dplyr' }),
      okResponse({ exact_match: true, usage: { input_tokens: 0, output_tokens: 0 } }),
      1
    );

    expect(record.exact_match).toBe(true);
  });

  test('labels outcomes by status code', () => {
    const outcome = status => buildRecord('chat', makeEvent({}), { statusCode: status, body: '' }, 1).outcome;

    expect(outcome(200)).toBe('success');
    expect(outcome(201)).toBe('success');
    expect(outcome(400)).toBe('rejected');
    expect(outcome(429)).toBe('rate_limited');
    expect(outcome(500)).toBe('error');
    expect(outcome(503)).toBe('error');
  });

  test('handles missing or invalid JSON bodies', () => {
    const event = { httpMethod: 'POST', headers: {}, body: 'not json' };
    const record = buildRecord('chat', event, { statusCode: 400, body: undefined }, 1);

    expect(record.status).toBe(400);
    expect(record.input_length).toBeUndefined();
    expect(record.input_tokens).toBeUndefined();
  });
});

// ==============================================================================
// hashClient()
// ==============================================================================

describe('hashClient', () => {
  const day1 = new Date('2026-10-22T10:00:00Z');
  const day1Later = new Date('2026-10-22T23:00:00Z');
  const day2 = new Date('2026-10-23T10:00:00Z');

  test('is stable for the same client on the same day', () => {
    expect(hashClient(IP, day1)).toBe(hashClient(IP, day1Later));
  });

  test('differs between clients', () => {
    expect(hashClient(IP, day1)).not.toBe(hashClient('198.51.100.1', day1));
  });

  test('changes from one day to the next', () => {
    expect(hashClient(IP, day1)).not.toBe(hashClient(IP, day2));
  });

  test('depends on AUDIT_LOG_SALT', () => {
    const unsalted = hashClient(IP, day1);
    process.env.AUDIT_LOG_SALT = 'site-secret';
    expect(hashClient(IP, day1)).not.toBe(unsalted);
  });
});

// ==============================================================================
// withAuditLog()
// ==============================================================================

describe('withAuditLog', () => {
  test('logs one line per request and returns the response unchanged', async () => {
    const response = okResponse({ usage: { input_tokens: 1, output_tokens: 2 } });
    const handler = withAuditLog('chat', async () => response);

    await expect(handler(makeEvent({ message: 'hi' }))).resolves.toBe(response);

    const records = loggedRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ endpoint: 'chat', status: 200, input_tokens: 1 });
  });

  test('logs rate-limited requests', async () => {
    const handler = withAuditLog('search', async () => ({ statusCode: 429, body: '{}' }));

    await handler(makeEvent({ query: 'x' }));

    expect(loggedRecords()[0].outcome).toBe('rate_limited');
  });

  test('logs and rethrows errors thrown by the handler', async () => {
    const handler = withAuditLog('search', async () => { throw new Error('boom'); });

    await expect(handler(makeEvent({ query: 'x' }))).rejects.toThrow('boom');

    expect(loggedRecords()[0]).toMatchObject({ status: 500, outcome: 'error' });
  });

  test('does not log CORS preflight requests', async () => {
    const handler = withAuditLog('chat', async () => ({ statusCode: 204, body: '' }));

    await handler(makeEvent(undefined, 'OPTIONS'));

    expect(logSpy).not.toHaveBeenCalled();
  });

  test('a logging failure does not break the request', async () => {
    logSpy.mockImplementation(() => { throw new Error('log sink down'); });
    const handler = withAuditLog('chat', async () => okResponse({}));

    await expect(handler(makeEvent({}))).resolves.toMatchObject({ statusCode: 200 });
  });
});

// ==============================================================================
// Wiring into the real handlers
// ==============================================================================

describe.each(['chat', 'search', 'reviews'])('%s handler', name => {
  test('writes an audit line', async () => {
    const { handler } = require(`../../netlify/functions/${name}`);

    const response = await handler(makeEvent(undefined, 'PUT'));

    expect(response.statusCode).toBe(405);
    const audit = loggedRecords().filter(r => r.audit);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ endpoint: name, method: 'PUT', status: 405, outcome: 'rejected' });
  });
});
