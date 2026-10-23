/**
 * The tool-name lists the host specs assert against, re-exported from the
 * single source the smoke check and the package surface share
 * (`src/constants.ts`): the read tools the write-off baseline expects, the
 * `writeEnabled`-gated write tools, and the union.
 * @module tests/helpers/tool-names
 */

export {
  ZOTERO_TOOL_NAMES,
  ZOTERO_READ_TOOL_NAMES,
  ZOTERO_WRITE_TOOL_NAMES,
} from '../../src/constants.js'

export const SCHOLARLY_TOOL_NAMES = [
  'scholarly_search',
  'scholarly_get',
  'scholarly_citations',
  'scholarly_read',
  'scholarly_cite',
  'scholarly_verify',
  'scholarly_save_to_zotero',
] as const
