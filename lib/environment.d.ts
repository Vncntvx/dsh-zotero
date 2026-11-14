/**
 * Host operating environment and platform detection.
 * @module dsh-zotero/environment
 */
/**
 * Determine whether the current process is running inside Windows Subsystem for Linux (WSL).
 * Checks explicit distribution/interop variables.
 */
export declare function isWsl(env?: NodeJS.ProcessEnv): boolean;
/**
 * Append or format a variable into WSLENV for Linux-to-Windows interop forwarding.
 * If varName is already in WSLENV, returns the existing WSLENV string untouched.
 */
export declare function appendWslEnv(env: NodeJS.ProcessEnv, varName: string): string;
/**
 * Credential-shaped names are never forwarded to a launcher child.
 *
 * This mirrors the harness's canonical scrub
 * (`packages/subprocess/subprocess/src/index.ts`: `SENSITIVE_ENV_PATTERN` and
 * `scrubbedParentEnv`) rather than depending on the subprocess service, which
 * brings a Service and its own peer set for this two-line rule.
 */
export declare const SENSITIVE_ENV_PATTERN: RegExp;
/**
 * Scrub one parent environment for a child process. The rule is
 * substring-based and case-insensitive, and all `DSH_*` names are dropped as
 * harness identity; a deliberately supplied value (such as the protocol URL)
 * is added after the scrub.
 * @param env - the environment the caller would have passed.
 * @returns a fresh environment without credential-shaped or `DSH_*` names.
 */
export declare function scrubbedEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
//# sourceMappingURL=environment.d.ts.map