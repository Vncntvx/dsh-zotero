/**
 * Configuration schema for the optional document-parsing component.
 *
 * The component's presence is the authorization to contact MinerU; the schema
 * describes only how it behaves once mounted. Every field is volatile so a
 * settings commit lands in the running fiber without remounting, and each read
 * resolves the live value. Defaults live in the shared `parsing-preferences`
 * contract; `resolveParsingConfig` only unwraps volatile references and
 * refuses malformed values — it does not re-implement the schema's rules.
 * @module dsh-zotero/parsing/config
 */

import type { Volatile } from '@deepseek-ai/cordis'
import { isVolatile } from '@deepseek-ai/cosmokit'
import Schema from '@deepseek-ai/schemastery'
import { PARSING_CREDENTIAL_REFERENCE_NAMES } from '../credential-names.js'
import {
  PARSING_DEFAULTS,
  PARSING_MODE_CHOICES,
  PARSING_OUTPUT_DIR_PATTERN,
  PARSING_PREFERENCE_KEYS,
  parsingPreferencesOf,
  type ParsingPreferences,
} from '../parsing-preferences.js'

export type ParsingConfig = {
  [K in keyof ParsingPreferences]?: ParsingPreferences[K] | Volatile<ParsingPreferences[K]>
}

const choices = (values: readonly (string | number)[]) =>
  Schema.union(values.map((value) => Schema.const(value)))

export const ParsingConfigSchema = Schema.object({
  mode: choices(PARSING_MODE_CHOICES)
    .default(PARSING_DEFAULTS.mode)
    .description('Which MinerU API to use: free (Agent lightweight) or pro (precise).')
    .volatile(),
  mineruTokenRef: Schema.string()
    .role('credential-ref')
    .default(PARSING_DEFAULTS.mineruTokenRef)
    .description(
      `Credential reference for the MinerU precise-API token (suggested: ${PARSING_CREDENTIAL_REFERENCE_NAMES.mineru}); ` +
        'only read in pro mode. Empty means no token is configured.',
    )
    .volatile(),
  allowParsingUpload: Schema.boolean()
    .default(PARSING_DEFAULTS.allowParsingUpload)
    .description(
      'Authorize sending document bytes (local attachments and URL PDFs) to MinerU. Data-egress authorization, independent of mounting the component.',
    )
    .volatile(),
  outputDir: Schema.string()
    .pattern(PARSING_OUTPUT_DIR_PATTERN)
    .default(PARSING_DEFAULTS.outputDir)
    .description(
      'Absolute directory for parsed artifacts (or a ~/... path); empty uses the harness default resolved at runtime. Relative paths are refused.',
    )
    .volatile(),
})

/** Read one live field's current value. */
function current<T>(value: unknown): T | undefined {
  if (value === undefined || value === null) return undefined
  return (isVolatile(value) ? value.get() : value) as T
}

/** Project one live config section into the plain values the enhancer reads. */
export function resolveParsingConfig(input?: Partial<ParsingConfig>): ParsingPreferences {
  const raw: Record<string, unknown> = {}
  for (const key of PARSING_PREFERENCE_KEYS) {
    const value = current<unknown>(input?.[key])
    if (value === undefined) continue
    // Text fields carry operator whitespace from hand-edited profiles; the
    // resolved shape is the canonical one (as `resolveScholarlyConfig` does
    // for its credential references).
    raw[key] = typeof value === 'string' ? value.trim() : value
  }
  return parsingPreferencesOf(raw)
}
