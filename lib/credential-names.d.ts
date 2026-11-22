/**
 * The suggested credential-reference names for the optional scholarly API
 * keys. One pure module so the host schema descriptions, the browser settings
 * copy, and the documentation consistency spec cannot drift apart.
 * @module dsh-zotero/credential-names
 */
/** Suggested environment-variable names, keyed by the public source id. */
export declare const SCHOLARLY_CREDENTIAL_REFERENCE_NAMES: {
    readonly semanticScholar: 'S2_API_KEY';
    readonly ncbi: 'NCBI_API_KEY';
    readonly openalex: 'OPENALEX_API_KEY';
};
/**
 * The three write-only secret controls and the reference field each feeds,
 * as `[secretKey, referenceField]` pairs. One tuple so the browser
 * controller's derived maps and the host resolver's field walk cannot drift
 * apart; the parity spec pins all three spellings to it.
 */
export declare const SCHOLARLY_KEY_FIELD_PAIRS: readonly [readonly ['s2Key', 's2ApiKeyEnv'], readonly ['ncbiKey', 'ncbiApiKeyEnv'], readonly ['openalexKey', 'openalexApiKeyEnv']];
/** Suggested environment-variable name for the MinerU precise-API token. */
export declare const ENRICHMENT_CREDENTIAL_REFERENCE_NAMES: {
    readonly mineru: 'MINERU_API_TOKEN';
};
/**
 * The document-enrichment component's single write-only secret and the
 * reference field that feeds it, as a `[secretKey, referenceField]` pair.
 * Kept separate from {@link SCHOLARLY_KEY_FIELD_PAIRS}: the scholarly parity
 * spec pins that tuple's length, and the two resolvers are independent.
 */
export declare const ENRICHMENT_KEY_FIELD_PAIRS: readonly [readonly ['mineruToken', 'mineruTokenRef']];
//# sourceMappingURL=credential-names.d.ts.map