/**
 * Host operating environment and platform detection.
 * @module dsh-zotero/environment
 */

/**
 * Determine whether the current process is running inside Windows Subsystem for Linux (WSL).
 * Checks explicit distribution/interop variables.
 */
export function isWsl(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP)
}

/**
 * Append or format a variable into WSLENV for Linux-to-Windows interop forwarding.
 * If varName is already in WSLENV, returns the existing WSLENV string untouched.
 */
export function appendWslEnv(env: NodeJS.ProcessEnv, varName: string): string {
  const current = env.WSLENV
  if (!current) return varName
  const parts = current.split(':')
  if (parts.includes(varName)) return current
  return `${current}:${varName}`
}
