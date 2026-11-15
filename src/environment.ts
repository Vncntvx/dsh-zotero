/**
 * Host operating environment and platform detection.
 *
 * Both questions this module answers are the harness's own: WSL detection is
 * `@deepseek-ai/dsh-native-command`'s `isWsl` (distribution variables *or* a
 * Microsoft kernel release), and the launcher environment scrub is
 * `@deepseek-ai/dsh-subprocess`'s `scrubbedParentEnv` (the canonical
 * `SENSITIVE_ENV_PATTERN` rule plus harness-owned names). Reusing them keeps
 * one definition per rule: a widening of either upstream rule reaches the
 * launcher child here without a local copy to forget.
 * @module dsh-zotero/environment
 */

import { isWsl as upstreamIsWsl } from '@deepseek-ai/dsh-native-command'
import { SENSITIVE_ENV_PATTERN, scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

/**
 * Determine whether a process is running inside Windows Subsystem for Linux.
 *
 * The harness rule: only a Linux platform can be WSL, and the answer is the
 * distribution/interop variables or a Microsoft-tagged kernel release. The
 * platform and environment are parameters so a caller can ask about facts it
 * has rather than only its own process.
 * @param env - the environment to inspect; the process environment by default.
 * @param platform - the platform to test; the current one by default.
 * @returns whether those facts describe WSL.
 */
export function isWsl(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return upstreamIsWsl({ platform, env })
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

/** Harness-owned names are never forwarded implicitly. */
const HARNESS_ENV_PREFIX = 'DSH_'

/**
 * Scrub one parent environment for a child process.
 *
 * The process environment is scrubbed by the harness's own
 * `scrubbedParentEnv`, which also layers the proxy variables a child needs to
 * reach the network the way the host does. An explicitly supplied environment
 * (a test's synthetic map, or a caller whose map *is* the whole child env) is
 * scrubbed with the same canonical rule — the upstream pattern and the `DSH_`
 * prefix — but without that layering, because the supplied map is the
 * environment the caller chose. A deliberately supplied value (such as the
 * protocol URL) is added after the scrub.
 * @param env - the environment the caller would have passed.
 * @returns a fresh environment without credential-shaped or `DSH_*` names.
 */
export function scrubbedEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (env === process.env) return scrubbedParentEnv()
  const scrubbed: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (SENSITIVE_ENV_PATTERN.test(name)) continue
    if (name.toUpperCase().startsWith(HARNESS_ENV_PREFIX)) continue
    scrubbed[name] = value
  }
  return scrubbed
}
