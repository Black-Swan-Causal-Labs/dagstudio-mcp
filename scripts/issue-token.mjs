// Issues a per-recipient trial-access token for the dag-studio-mcp Worker and
// writes it to the TOKENS KV namespace (item 11). The Worker validates these on
// every request; see src/worker/auth.ts and notes/mcp-backlog.md item 11.
//
// Usage:
//   node scripts/issue-token.mjs <recipient> [duration] [quota] [flags]
//
// Positionals:
//   recipient   required; a label for who the token is for (e.g. "alice")
//   duration    optional; e.g. 7d, 24h, 90m, 3600s (default: 7d)
//   quota        optional; integer request budget (default: 1000)
//
// Flags:
//   --no-expiry        owner-style token that never expires
//   --no-quota         owner-style token with no request budget
//   --label="..."     human note stored on the record
//   --binding=NAME     KV binding name (default: TOKENS)
//   --dry-run          print the record and the wrangler command, write nothing
//
// Examples:
//   node scripts/issue-token.mjs alice 7d 1000
//   node scripts/issue-token.mjs jdd-owner --no-expiry --no-quota
//   node scripts/issue-token.mjs bob 30d 5000 --label="paper reviewer"

import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const MCP_URL = 'https://dagstudio-mcp.blackswancausallabs.com/mcp';

function fail(msg) {
  console.error(`error: ${msg}`);
  console.error('usage: node scripts/issue-token.mjs <recipient> [duration] [quota] [--no-expiry] [--no-quota] [--label="..."] [--binding=NAME] [--dry-run]');
  process.exit(1);
}

// "7d" / "24h" / "90m" / "3600s" -> milliseconds.
function parseDuration(s) {
  const m = /^(\d+)\s*([smhd])$/.exec(s.trim());
  if (!m) fail(`could not parse duration "${s}" (expected e.g. 7d, 24h, 90m, 3600s)`);
  const n = Number(m[1]);
  const unit = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 }[m[2]];
  return n * unit;
}

const argv = process.argv.slice(2);
const flags = new Map();
const positionals = [];
for (const arg of argv) {
  if (arg.startsWith('--')) {
    const [k, v] = arg.slice(2).split(/=(.*)/s);
    flags.set(k, v === undefined ? true : v);
  } else {
    positionals.push(arg);
  }
}

const recipient = positionals[0];
if (!recipient) fail('recipient is required');

const noExpiry = flags.has('no-expiry');
const noQuota = flags.has('no-quota');
const dryRun = flags.has('dry-run');
const binding = typeof flags.get('binding') === 'string' ? flags.get('binding') : 'TOKENS';
const label = typeof flags.get('label') === 'string' ? flags.get('label') : undefined;

const durationStr = positionals[1] ?? '7d';
const quotaStr = positionals[2] ?? '1000';

const now = new Date();
const expires_at = noExpiry ? null : new Date(now.getTime() + parseDuration(durationStr)).toISOString();

let requests_remaining = null;
if (!noQuota) {
  requests_remaining = Number(quotaStr);
  if (!Number.isInteger(requests_remaining) || requests_remaining <= 0) {
    fail(`quota must be a positive integer (got "${quotaStr}")`);
  }
}

const token = `tk_${randomBytes(8).toString('hex')}`;
const record = {
  recipient,
  issued_at: now.toISOString(),
  expires_at,
  requests_remaining,
  ...(label ? { label } : {}),
};
const recordJson = JSON.stringify(record);

const wranglerArgs = ['wrangler', 'kv', 'key', 'put', '--binding', binding, '--remote', token, recordJson];

if (dryRun) {
  console.error('[dry-run] no write performed');
  console.error(`[dry-run] would run: npx ${wranglerArgs.join(' ')}`);
} else {
  try {
    execFileSync('npx', wranglerArgs, { stdio: ['ignore', 'inherit', 'inherit'] });
  } catch {
    fail('wrangler kv write failed (check that the TOKENS namespace exists, its id is set in wrangler.jsonc, and your wrangler auth has KV edit scope)');
  }
}

const kind = expires_at === null && requests_remaining === null ? 'owner' : 'trial';
console.log('');
console.log(`Issued ${kind} token for "${recipient}"`);
console.log(`  token:    ${token}`);
console.log(`  record:   ${recordJson}`);
console.log(`  expires:  ${expires_at ?? 'never'}`);
console.log(`  quota:    ${requests_remaining ?? 'unlimited'}`);
console.log('');
console.log('Share URL (Claude.ai web connector / browser):');
console.log(`  ${MCP_URL}?token=${token}`);
console.log('');
console.log('Header form (Claude Code):');
console.log(`  claude mcp add --transport http dag-studio ${MCP_URL} --header "Authorization: Bearer ${token}"`);
console.log('');
console.log('Reminder: the URL form carries the token in the URL. Tell the recipient');
console.log('not to share, post, or screenshot it. Revoke by deleting the KV key.');
