/**
 * Resolve the scholarly API keys through the credentials seam.
 *
 * Configuration carries credential-reference names only; the values live in
 * the host credentials provider and are re-read before every external tool
 * call. An empty reference disables that optional key; a non-empty reference
 * that cannot be resolved is a configuration failure, never a silent
 * anonymous request.
 * @module dsh-zotero/scholarly/credentials
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ResolvedScholarlyConfig } from './config.js';
import type { ScholarlyKeys } from './types.js';
/**
 * Resolve every configured key reference at one tool-call boundary.
 * @param ctx - the scholarly component's context.
 * @param config - the live resolved config section.
 * @returns the key values the source adapters send, or absent fields for unset references.
 * @throws {ZoteroError} when a configured reference is invalid, the credentials
 *   seam is absent, or the reference resolves to no value.
 */
export declare function resolveScholarlyKeys(ctx: Context, config: ResolvedScholarlyConfig): Promise<ScholarlyKeys>;
//# sourceMappingURL=credentials.d.ts.map