// engine_version composer. ENGINE_SEMVER comes from the engine itself; the
// short git hash is stamped into src/generated/build-info.ts by
// scripts/stamp-version.mjs (run as predev/prebuild). Format follows spec §5.1
// (`{semver}+{short-hash}`).

import { ENGINE_SEMVER } from '../dag-engine.js';
import { ENGINE_GIT_HASH } from './generated/build-info.js';

export { ENGINE_SEMVER, ENGINE_GIT_HASH };
export const ENGINE_VERSION: `${string}+${string}` = `${ENGINE_SEMVER}+${ENGINE_GIT_HASH}`;
