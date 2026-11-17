/**
 * The build approvals this plugin's published dependency tree requires: none.
 * @module scripts/shared/build-approvals
 */

/** Every install script this plugin's dependency tree needs a decision for. */
export declare const APPROVED_BUILD_SCRIPTS: readonly string[]

/** Compare the install hooks a dependency tree declares with the approved list. */
export declare function approvalGaps(
  declared: readonly string[],
  approved?: readonly string[],
): { missing: string[]; stale: string[] }
