import { valid } from 'semver'

/**
 * One lockfile entry's face these helpers read.
 * @typedef {{ dependencies?: Record<string, string | undefined> }} LockfileEntry
 * @typedef {Record<string, LockfileEntry | undefined>} LockfilePackages
 */

/**
 * Resolve one dependency from a lockfile entry the way Node walks up parents.
 * @param {LockfilePackages} packages - the lockfile's `packages` map, keyed by install path.
 * @param {string} fromPath - the entry path the dependency is asked from.
 * @param {string} name - the dependency name.
 * @returns {string | undefined} the resolved entry path, or undefined when the lock cannot answer.
 */
export function lockedPathOf(packages, fromPath, name) {
  let scope = fromPath
  for (;;) {
    const candidate = scope === '' ? `node_modules/${name}` : `${scope}/node_modules/${name}`
    if (packages[candidate] !== undefined) return candidate
    if (scope === '') return undefined
    const cut = scope.lastIndexOf('node_modules/')
    scope = cut <= 0 ? '' : scope.slice(0, cut - 1)
  }
}
/**
 * Exact Undici version declared by the locked Harness HTTP proxy.
 * @param {{ packages?: LockfilePackages }} lock - the parsed package-lock.json.
 * @returns {string} the exact undici version.
 */
export function lockedProxyUndiciVersion(lock) {
  const packages = lock.packages ?? {}
  const proxy = packages['node_modules/@deepseek-ai/dsh-http-proxy']
  const version = proxy?.dependencies?.undici
  if (typeof version !== 'string' || valid(version) === null)
    throw new Error('locked @deepseek-ai/dsh-http-proxy must declare an exact undici dependency')
  return version
}
