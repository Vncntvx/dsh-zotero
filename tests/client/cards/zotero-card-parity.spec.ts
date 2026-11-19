/**
 * The card's field table and the host `Config` schema are two spellings of one
 * surface. The controller binds the **key set** at compile time
 * (`_configSurfaceComplete`); this test binds the **control kind** at runtime,
 * which no type can express: a field declared `text` while the schema says
 * `number` would render a control that stages values the host rejects, and the
 * staged form would fail on save with nothing pointing at the mismatch.
 *
 * It also re-asserts the key set at runtime, so a schema built through
 * indirection the compiler cannot see still fails here rather than in the
 * browser.
 * @module tests/client/cards/zotero-card-parity
 */

import { describe, expect, it } from 'vitest'
import {
  CITATION_FIELD_KEYS,
  type CitationFieldKey,
} from '../../../src/client/citation-form-controller.ts'
import { Config, type ResolvedConfig } from '../../../src/config.ts'
import {
  ALL_FIELD_KEYS,
  BOOLEAN_FIELD_KEYS,
  FIELD_GROUPS,
  HIDDEN_FIELD_KEYS,
  NUMERIC_FIELD_KEYS,
  VISIBLE_FIELD_KEYS,
  type FieldKey,
} from '../../../src/client/zotero-card-controller.ts'

type MissingConfigField = Exclude<keyof ResolvedConfig, FieldKey | CitationFieldKey>
type AssertNever<T extends never> = T
export type _ConfigSurfaceComplete = AssertNever<MissingConfigField>

/** The control a host schema type must render as. */
const CONTROL_OF_SCHEMA_TYPE = {
  string: 'text',
  number: 'number',
  boolean: 'boolean',
} as const satisfies Record<string, 'text' | 'number' | 'boolean'>

/** The visible field keys, in display order. */
const FIELD_KEYS: readonly (FieldKey | CitationFieldKey)[] = [
  ...ALL_FIELD_KEYS,
  ...CITATION_FIELD_KEYS,
]

/** The 13 fields the settings page renders, in display order. */
const VISIBLE_FIELDS: readonly FieldKey[] = [
  'webEnabled',
  'writeEnabled',
  'writePersistKey',
  'baseUrl',
  'timeoutMs',
  'maxSearchResults',
  'maxBrowseResults',
  'maxEvidenceChars',
  'maxEvidencePassages',
  'maxFulltextChars',
  'enableRunInBackground',
  'promoteOnTimeout',
  'debug',
]

/** The 24 fields that remain in the schema and the profile config file only. */
const HIDDEN_FIELDS: readonly FieldKey[] = [
  'writeNoteMaxChars',
  'writeFieldMaxChars',
  'writeListMaxItems',
  'writeAuthorizeDeadlineMs',
  'provider',
  'maxInFlightRequests',
  'scopeListingTtlMs',
  'maxNoteScanRecords',
  'searchConcurrency',
  'graphConcurrency',
  'retrieveAttachmentCap',
  'maxNoteChars',
  'maxNoteRecords',
  'maxAnnotationRecords',
  'maxAttachmentRecords',
  'fulltextChunkWords',
  'fulltextWindowChars',
  'maxInlineResultTokens',
  'maxInlineResultBytes',
  'maxResponseBytes',
  'maxExportChars',
  'maxExportRefs',
  'maxChangesResults',
  'foregroundWaitMs',
]

const numericKeys: ReadonlySet<string> = NUMERIC_FIELD_KEYS
const booleanKeys: ReadonlySet<string> = BOOLEAN_FIELD_KEYS

/** The control kind the card renders for one field. */
function controlKindOf(key: FieldKey | CitationFieldKey): 'text' | 'number' | 'boolean' {
  if (numericKeys.has(key)) return 'number'
  if (booleanKeys.has(key)) return 'boolean'
  return 'text'
}

/**
 * The schema's own field table. Schemastery types `dict` as a mapped type over
 * the declared shape, so reading it generically goes through the runtime shape
 * the library actually exposes (a record of field schemas carrying `type`).
 */
const SCHEMA_FIELDS: Readonly<Record<string, { readonly type: string } | undefined>> =
  (Config as { dict?: Readonly<Record<string, { readonly type: string }>> }).dict ?? {}

/** The host schema's declared type for one field, or undefined when absent. */
function schemaTypeOf(key: string): string | undefined {
  return SCHEMA_FIELDS[key]?.type
}

describe('Zotero settings card parity with the host Config schema', () => {
  it('lists every host Config field exactly once', () => {
    const declared = Object.keys(SCHEMA_FIELDS)
    expect(declared.length).toBeGreaterThan(0)
    expect([...FIELD_KEYS].sort()).toEqual([...declared].sort())
    expect(new Set(FIELD_KEYS).size).toBe(FIELD_KEYS.length)
  })

  it('keeps the visible and hidden partitions exact and disjoint', () => {
    expect(VISIBLE_FIELD_KEYS).toEqual(VISIBLE_FIELDS)
    expect(HIDDEN_FIELD_KEYS).toEqual(HIDDEN_FIELDS)
    expect([...VISIBLE_FIELD_KEYS, ...HIDDEN_FIELD_KEYS].sort()).toEqual([...ALL_FIELD_KEYS].sort())
    expect(FIELD_GROUPS.flatMap((group) => group.fields)).toEqual(VISIBLE_FIELD_KEYS)
    expect(FIELD_GROUPS.map((group) => group.key)).toEqual([
      'groupWeb',
      'groupWrite',
      'groupConnection',
      'groupSearchQuery',
      'groupSearchEvidence',
      'groupJobs',
      'groupDiagnostics',
    ])
  })

  it('renders each field with the control its schema type requires', () => {
    for (const key of FIELD_KEYS) {
      const schemaType = schemaTypeOf(key)
      expect(schemaType, `${key} is absent from the host schema`).toBeDefined()
      const expected = CONTROL_OF_SCHEMA_TYPE[schemaType as keyof typeof CONTROL_OF_SCHEMA_TYPE]
      expect(expected, `${key} has an unmapped schema type "${schemaType}"`).toBeDefined()
      expect(controlKindOf(key), `${key} renders the wrong control for "${schemaType}"`).toBe(
        expected,
      )
    }
  })

  it('never classifies a field as both a number and a boolean', () => {
    for (const key of FIELD_KEYS) {
      const matches = [numericKeys.has(key), booleanKeys.has(key)].filter(Boolean)
      expect(
        matches.length,
        `${key} is classified as both a number and a boolean field`,
      ).toBeLessThan(2)
    }
  })
})
