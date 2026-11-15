/**
 * The build approvals this plugin's published dependency tree requires: none.
 *
 * The semantic runtime `onnxruntime-web` pulls `protobufjs`, whose
 * `postinstall` is a no-op, and pnpm 11 fails an install while any dependency
 * script has no decision (`ERR_PNPM_IGNORED_BUILDS`). The runtime is therefore
 * not a dependency: the plugin ships its build artifacts inside the package
 * (`scripts/vendor-onnxruntime.mjs`) and installs clean. This ledger stays
 * empty so a future dependency that declares an install script fails the guard
 * spec below instead of blocking every install until the profile approves it.
 *
 * One list, two consumers: the tooling guard spec keeps it equal to the
 * production dependency tree, and the install docs name it (an empty list
 * names nothing).
 * @module scripts/shared/build-approvals
 */

/** Hooks pnpm treats as a build script; `prepare` belongs to source installs. */
const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall']

/** Every install script this plugin's dependency tree needs a decision for. */
export const APPROVED_BUILD_SCRIPTS = Object.freeze([])

/**
 * The install hooks a package manifest declares.
 * @param manifest parsed `package.json`
 * @returns the hook names it declares, in hook order
 */
export function buildScriptHooksOf(manifest) {
  const scripts = manifest?.scripts ?? {}
  return INSTALL_HOOKS.filter((hook) => typeof scripts[hook] === 'string')
}

/**
 * Compare the install hooks a dependency tree declares with the approved list.
 * A declared name outside the list needs a decision; an approved name with
 * nothing left to run is a stale entry that would hide the next change.
 * @param declared package names whose manifest declares an install hook
 * @param approved names the profile approves
 * @returns the names needing a decision and the approvals with nothing to run
 */
export function approvalGaps(declared, approved = APPROVED_BUILD_SCRIPTS) {
  const declaredSet = new Set(declared)
  const approvedSet = new Set(approved)
  return {
    missing: declared.filter((name) => !approvedSet.has(name)),
    stale: approved.filter((name) => !declaredSet.has(name)),
  }
}
