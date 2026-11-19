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
};
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
];
/** Suggested environment-variable name for the MinerU precise-API token. */
export const ENRICHMENT_CREDENTIAL_REFERENCE_NAMES = {
    mineru: 'MINERU_API_TOKEN',
};
/**
 * The document-enrichment component's single write-only secret and the
 * reference field that feeds it, as a `[secretKey, referenceField]` pair.
 * Kept separate from {@link SCHOLARLY_KEY_FIELD_PAIRS}: the scholarly parity
 * spec pins that tuple's length, and the two resolvers are independent.
 */
export const ENRICHMENT_KEY_FIELD_PAIRS = [['mineruToken', 'mineruTokenRef']];
//# sourceMappingURL=credential-names.js.map