// Static ConcordanceAttestation (spec §5.3). The release-gate concordance job
// in ci/concordance.mjs rewrites this file at release time with the actual
// dagitty version, commit, validation timestamp, and case counts. The
// scaffolded values report cases_validated:0 and validated_at:null so dev runs
// surface the unvalidated state honestly rather than emitting a false
// concordance claim.

import type { ConcordanceAttestation } from './schemas.js';

export const ATTESTATION: ConcordanceAttestation = {
  reference_engine: 'dagitty',
  reference_version: '0.0.0-unstamped',
  reference_commit: '0000000',
  validated_at: null,
  cases_validated: 0,
  cases_concordant: 0,
};
