// Per-recipient trial-access gate for the dag-studio-mcp Worker.
//
// Tokens are opaque strings (`tk_<hex>`) whose metadata lives in a Cloudflare
// KV namespace bound as TOKENS. This module holds the pure decision logic so it
// can be unit-tested without a Worker runtime or live KV; src/worker/index.ts
// does the actual KV read/write around these functions.
//
// Design source of truth: notes/mcp-backlog.md item 11 (public dag-studio repo,
// gitignored). Accepted tradeoffs (token-in-URL hygiene, shared quota on
// forward, approximate KV-counter quota) are documented there.

const ACCESS_EMAIL = 'jdiazdecaro@blackswancausallabs.com';

export interface TokenRecord {
  recipient: string;
  issued_at: string;            // ISO 8601
  expires_at: string | null;    // ISO 8601, or null to skip the expiry check
  requests_remaining: number | null; // integer, or null to skip the quota check
  label?: string;
}

export interface AuthVerdict {
  ok: boolean;
  status?: number; // set when ok === false
  error?: string;  // set when ok === false
}

// Pull the token from an `Authorization: Bearer <token>` header or a `?token=`
// query param. Header wins. The query-param fallback exists because Claude.ai's
// web custom-connector UI exposes no custom-header field (see the
// project_claude_ai_connector_auth memory). Returns null when neither carries a
// non-empty token.
export function extractToken(
  authHeader: string | null,
  urlToken: string | null,
): string | null {
  const fromHeader = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
  if (fromHeader) return fromHeader;
  const fromUrl = urlToken ? urlToken.trim() : '';
  return fromUrl || null;
}

// Decide whether a request bearing `record` may proceed at time `now`.
// A null `expires_at` skips the expiry check; a null `requests_remaining` skips
// the quota check. Both null = owner token; both set = trial token.
export function evaluateToken(
  record: TokenRecord | null,
  now: Date = new Date(),
): AuthVerdict {
  if (!record) {
    return {
      ok: false,
      status: 401,
      error: `Trial token required. Request access at ${ACCESS_EMAIL}.`,
    };
  }
  if (record.expires_at !== null && new Date(record.expires_at).getTime() < now.getTime()) {
    return {
      ok: false,
      status: 401,
      error: `Trial token expired. Email ${ACCESS_EMAIL} for a renewal.`,
    };
  }
  if (record.requests_remaining !== null && record.requests_remaining <= 0) {
    return {
      ok: false,
      status: 429,
      error: `Trial token quota exhausted. Email ${ACCESS_EMAIL} for more.`,
    };
  }
  return { ok: true };
}

// The record to persist after a successful request, or null when no write is
// needed (unlimited-quota / owner tokens). Quota is metered approximately:
// concurrent requests racing the read-modify-write may overcount slightly,
// which is acceptable for trial purposes.
export function decrementedRecord(record: TokenRecord): TokenRecord | null {
  if (record.requests_remaining === null) return null;
  return { ...record, requests_remaining: record.requests_remaining - 1 };
}
