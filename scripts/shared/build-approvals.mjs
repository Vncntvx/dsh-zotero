/**
 * The build scripts a profile must approve before this plugin installs from a
 * packed tarball or a registry. `onnxruntime-web` (local semantic ranking)
 * depends on `protobufjs`, whose `postinstall` only checks its version scheme;
 * pnpm 11 treats an undecided build script as a failure
 * (`ERR_PNPM_IGNORED_BUILDS`), so the install has to record the decision in the
 * profile's `pnpm-workspace.yaml`.
 *
 * One list, three consumers: the discovery smoke seeds it, the tooling guard
 * spec keeps it equal to the production dependency tree, and the install docs
 * name it.
 * @module scripts/shared/build-approvals
 */

/** Hooks pnpm treats as a build script; `prepare` belongs to source installs. */
const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall']

/** Every install script this plugin's dependency tree needs a decision for. */
export const APPROVED_BUILD_SCRIPTS = Object.freeze(['protobufjs'])

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
 * The profile policy block that approves the given scripts.
 * @param names package names to approve
 * @returns the YAML block, newline-terminated
 */
export function policyYaml(names = APPROVED_BUILD_SCRIPTS) {
  return `allowBuilds:\n${names.map((name) => `  ${name}: true`).join('\n')}\n`
}

/**
 * Which approved scripts a profile policy still lacks.
 * @param text current `pnpm-workspace.yaml` content, or undefined when absent
 * @param names package names that must be approved
 * @returns the names with no `name: true` entry; every name when the text is absent
 */
export function missingApprovals(text, names = APPROVED_BUILD_SCRIPTS) {
  if (text === undefined) return [...names]
  const approved = new Set(
    [...text.matchAll(/^\s*([^\s#:]+):\s*true\s*$/gm)].map((match) => match[1]),
  )
  return names.filter((name) => !approved.has(name))
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
