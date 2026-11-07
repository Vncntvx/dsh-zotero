/**
 * The suggested credential-reference names for the optional scholarly API
 * keys. One pure module so the host schema descriptions, the browser settings
 * copy, and the documentation consistency spec cannot drift apart.
 * @module dsh-zotero/credential-names
 */

/** Suggested environment-variable names, keyed by the public source id. */
export const SCHOLARLY_CREDENTIAL_REFERENCE_NAMES = {
  semanticScholar: 'S2_API_KEY',
  ncbi: 'NCBI_API_KEY',
  openalex: 'OPENALEX_API_KEY',
} as const

/**
 * The three write-only secret controls and the reference field each feeds,
 * as `[secretKey, referenceField]` pairs. One tuple so the browser
 * controller's derived maps and the host resolver's field walk cannot drift
 * apart; the parity spec pins all three spellings to it.
 */
export const SCHOLARLY_KEY_FIELD_PAIRS = [
  ['s2Key', 's2ApiKeyEnv'],
  ['ncbiKey', 'ncbiApiKeyEnv'],
  ['openalexKey', 'openalexApiKeyEnv'],
] as const
