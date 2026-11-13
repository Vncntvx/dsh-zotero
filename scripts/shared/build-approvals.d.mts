/**
 * The build scripts a profile must approve before this plugin installs.
 * @module scripts/shared/build-approvals
 */

/** Every install script this plugin's dependency tree needs a decision for. */
export declare const APPROVED_BUILD_SCRIPTS: readonly string[]

/** The install hooks a package manifest declares. */
export declare function buildScriptHooksOf(manifest: {
  readonly scripts?: Readonly<Record<string, string>>
}): string[]

/** The profile policy block that approves the given scripts. */
export declare function policyYaml(names?: readonly string[]): string

/** Which approved scripts a profile policy still lacks. */
export declare function missingApprovals(
  text: string | undefined,
  names?: readonly string[],
): string[]

/** Compare the install hooks a dependency tree declares with the approved list. */
export declare function approvalGaps(
  declared: readonly string[],
  approved?: readonly string[],
): { missing: string[]; stale: string[] }
