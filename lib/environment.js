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
//# sourceMappingURL=environment.js.map