/**
 * Host operating environment and platform detection.
 * @module dsh-zotero/environment
 */
/**
 * Determine whether the current process is running inside Windows Subsystem for Linux (WSL).
 * Checks explicit distribution/interop variables.
 */
export function isWsl(env = process.env) {
    return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
}
/**
 * Append or format a variable into WSLENV for Linux-to-Windows interop forwarding.
 * If varName is already in WSLENV, returns the existing WSLENV string untouched.
 */
export function appendWslEnv(env, varName) {
    const current = env.WSLENV;
    if (!current)
        return varName;
    const parts = current.split(':');
    if (parts.includes(varName))
        return current;
    return `${current}:${varName}`;
}
/**
 * Credential-shaped names are never forwarded to a launcher child.
 *
 * This mirrors the harness's canonical scrub
 * (`packages/subprocess/subprocess/src/index.ts`: `SENSITIVE_ENV_PATTERN` and
 * `scrubbedParentEnv`) rather than depending on the subprocess service, which
 * brings a Service and its own peer set for this two-line rule.
 */
export const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i;
/** Harness-owned names are never forwarded implicitly. */
const HARNESS_ENV_PREFIX = 'DSH_';
/**
 * Scrub one parent environment for a child process. The rule is
 * substring-based and case-insensitive, and all `DSH_*` names are dropped as
 * harness identity; a deliberately supplied value (such as the protocol URL)
 * is added after the scrub.
 * @param env - the environment the caller would have passed.
 * @returns a fresh environment without credential-shaped or `DSH_*` names.
 */
export function scrubbedEnvironment(env) {
    const scrubbed = {};
    for (const [name, value] of Object.entries(env)) {
        if (SENSITIVE_ENV_PATTERN.test(name))
            continue;
        if (name.toUpperCase().startsWith(HARNESS_ENV_PREFIX))
            continue;
        scrubbed[name] = value;
    }
    return scrubbed;
}
//# sourceMappingURL=environment.js.map