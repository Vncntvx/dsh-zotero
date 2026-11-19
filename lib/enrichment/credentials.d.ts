/**
 * Resolve the MinerU precise-API token through the harness credentials seam.
 *
 * Configuration carries a credential-reference name only; the value lives in
 * the host credentials provider and is re-read before every parse. Fail-closed:
 * a non-empty reference that cannot be resolved is a configuration failure,
 * never a silent fallback to the free API or an anonymous request. The free
 * API never calls this module at all.
 * @module dsh-zotero/enrichment/credentials
 */
import type { Context } from '@deepseek-ai/cordis';
/**
 * Resolve the precise-API token for one parse.
 * @param ctx - the enrichment component's context.
 * @param reference - the configured credential-reference name (trimmed).
 * @returns the token value.
 * @throws {ZoteroError} `ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED` when the reference
 *   is invalid, the credentials seam is absent, or the value is empty.
 */
export declare function resolveMineruToken(ctx: Context, reference: string): Promise<string>;
//# sourceMappingURL=credentials.d.ts.map