// Run with: npm run test:tools (uses tsx loader + node:test)

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decrementedRecord,
  evaluateToken,
  extractToken,
  type TokenRecord,
} from '../src/worker/auth.js';

const ISSUED = '2026-05-01T00:00:00.000Z';
const NOW = new Date('2026-05-28T00:00:00.000Z');

function rec(overrides: Partial<TokenRecord> = {}): TokenRecord {
  return {
    recipient: 'alice',
    issued_at: ISSUED,
    expires_at: '2026-06-01T00:00:00.000Z',
    requests_remaining: 1000,
    ...overrides,
  };
}

test('extractToken: Authorization bearer header', () => {
  assert.equal(extractToken('Bearer tk_abc123', null), 'tk_abc123');
});

test('extractToken: bearer prefix is case-insensitive and whitespace-tolerant', () => {
  assert.equal(extractToken('bearer   tk_abc123  ', null), 'tk_abc123');
});

test('extractToken: raw token without Bearer prefix is accepted', () => {
  assert.equal(extractToken('tk_raw', null), 'tk_raw');
});

test('extractToken: query param fallback', () => {
  assert.equal(extractToken(null, 'tk_fromurl'), 'tk_fromurl');
});

test('extractToken: header wins over query param', () => {
  assert.equal(extractToken('Bearer tk_header', 'tk_url'), 'tk_header');
});

test('extractToken: empty bearer falls through to query param', () => {
  assert.equal(extractToken('Bearer ', 'tk_url'), 'tk_url');
});

test('extractToken: neither present returns null', () => {
  assert.equal(extractToken(null, null), null);
  assert.equal(extractToken('', ''), null);
});

test('evaluateToken: missing record is 401', () => {
  const v = evaluateToken(null, NOW);
  assert.equal(v.ok, false);
  assert.equal(v.status, 401);
  assert.match(v.error!, /Trial token required/);
});

test('evaluateToken: expired token is 401', () => {
  const v = evaluateToken(rec({ expires_at: '2026-05-27T23:59:59.000Z' }), NOW);
  assert.equal(v.ok, false);
  assert.equal(v.status, 401);
  assert.match(v.error!, /expired/);
});

test('evaluateToken: future expiry passes', () => {
  assert.equal(evaluateToken(rec({ expires_at: '2026-12-31T00:00:00.000Z' }), NOW).ok, true);
});

test('evaluateToken: null expiry skips the expiry check', () => {
  assert.equal(evaluateToken(rec({ expires_at: null }), NOW).ok, true);
});

test('evaluateToken: exhausted quota is 429', () => {
  const v = evaluateToken(rec({ requests_remaining: 0 }), NOW);
  assert.equal(v.ok, false);
  assert.equal(v.status, 429);
  assert.match(v.error!, /quota exhausted/);
});

test('evaluateToken: negative quota is 429', () => {
  assert.equal(evaluateToken(rec({ requests_remaining: -5 }), NOW).status, 429);
});

test('evaluateToken: null quota skips the quota check', () => {
  assert.equal(evaluateToken(rec({ requests_remaining: null }), NOW).ok, true);
});

test('evaluateToken: owner token (both null) passes', () => {
  assert.equal(evaluateToken(rec({ expires_at: null, requests_remaining: null }), NOW).ok, true);
});

test('evaluateToken: expiry is checked before quota', () => {
  // Both bad: expired AND exhausted. Expiry should win (401, not 429).
  const v = evaluateToken(rec({ expires_at: '2020-01-01T00:00:00.000Z', requests_remaining: 0 }), NOW);
  assert.equal(v.status, 401);
});

test('decrementedRecord: finite quota decrements by one', () => {
  const next = decrementedRecord(rec({ requests_remaining: 3 }));
  assert.equal(next?.requests_remaining, 2);
});

test('decrementedRecord: preserves other fields', () => {
  const next = decrementedRecord(rec({ requests_remaining: 3, label: 'reviewer' }));
  assert.equal(next?.recipient, 'alice');
  assert.equal(next?.label, 'reviewer');
  assert.equal(next?.expires_at, '2026-06-01T00:00:00.000Z');
});

test('decrementedRecord: unlimited quota returns null (no write)', () => {
  assert.equal(decrementedRecord(rec({ requests_remaining: null })), null);
});
