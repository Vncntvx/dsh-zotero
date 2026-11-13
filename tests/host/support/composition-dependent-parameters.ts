/**
 * Parameters whose presence in a tool schema depends on the composition: the
 * deployment flag and a mounted job registry. The tool reference documents
 * them in prose, because a parameter table is compared against one composition
 * at a time and the two doc-contract specs run different ones. Both directions
 * skip these names and assert the prose marker instead, so the contract stays
 * checked rather than merely exempted.
 * @module tests/host/support/composition-dependent-parameters
 */

/** Tool name to the parameters that only some compositions declare. */
export const COMPOSITION_DEPENDENT_PARAMETERS: Readonly<Record<string, readonly string[]>> = {
  zotero_export: ['run_in_background'],
  zotero_changes: ['run_in_background'],
  scholarly_search: ['run_in_background'],
  scholarly_read: ['run_in_background'],
  scholarly_verify: ['run_in_background'],
}

/** The sentence the tool reference uses instead of a table row. */
export const COMPOSITION_DEPENDENT_MARKERS = ['不是恒声明参数', 'is not a fixed parameter'] as const

/** Whether one tool parameter is composition-dependent. */
export function isCompositionDependent(tool: string, parameter: string): boolean {
  return COMPOSITION_DEPENDENT_PARAMETERS[tool]?.includes(parameter) === true
}
