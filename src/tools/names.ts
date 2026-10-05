/**
 * The plugin's tool-name vocabulary, single-sourced for every reader that
 * must stay in step with registration: the smoke check asserts the built
 * registry against it, and the host specs import the same constants instead
 * of hand-copied lists that rot when a tool joins.
 *
 * The write list stays in `constants.ts` (the model-facing policy and the
 * shell-write detector's audit copy quote it verbatim); this module derives
 * from it so a ninth write tool updates every consumer at once.
 * @module dsh-zotero/tools/names
 */

import { WRITE_TOOL_NAMES } from '../constants.js'

/** The write tools, as `reconcileWriteTools` registers them (gated by `writeEnabled`). */
export const ZOTERO_WRITE_TOOL_NAMES = WRITE_TOOL_NAMES

/** The eight read tools, in `ZoteroService` registration order (export and
 * `zotero_changes` register unconditionally; only their `run_in_background`
 * parameter waits on the jobs service). */
export const ZOTERO_READ_TOOL_NAMES = [
  'zotero_search',
  'zotero_get',
  'zotero_children',
  'zotero_attachment',
  'zotero_retrieve',
  'zotero_export',
  'zotero_browse',
  'zotero_changes',
] as const

/** Every tool the plugin can register, reads and writes together. */
export const ZOTERO_TOOL_NAMES = [...ZOTERO_READ_TOOL_NAMES, ...ZOTERO_WRITE_TOOL_NAMES] as const
