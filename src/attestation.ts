// Static ConcordanceAttestation (spec §5.3). Updated by ci/concordance.mjs
// at release time. Do not edit by hand.

import type { ConcordanceAttestation } from './schemas.js';

export const ATTESTATION: ConcordanceAttestation = {
  reference_engine: 'dagitty',
  reference_version: 'git-7a65777',
  reference_commit: '7a65777',
  validated_at: '2026-07-06T18:17:13.956Z',
  cases_validated: 15,
  cases_concordant: 15,
};
