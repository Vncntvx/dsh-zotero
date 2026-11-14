/**
 * Private active parsing domain. Only an explicitly started enrichment job
 * calls this entry; the core reader can only look up committed artifacts.
 * Configuration and generation belong to the job's immutable snapshot.
 * @module dsh-zotero/enrichment/parse-document
 */
import { ENRICHMENT_CREDENTIAL_REFERENCE_NAMES } from '../credential-names.js';
import { errorMessageOf, ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED, ZOTERO_ENRICHMENT_TASK_FAILED, ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT, ZOTERO_INVALID_ARGUMENT, ZoteroError, } from '../errors.js';
import { isPdfCandidateContentType, } from '../local/fulltext-enhancer.js';
import { resolveEnrichmentConfig } from './config.js';
import { canonicalSourceIdentityOf } from './identity.js';
import { PARSE_GENERATION } from './artifact-schema.js';
import { cacheKeyOf, contentFingerprintOf, parseOnce, } from './parse-once.js';
import { hostSourceBytesDeps, obtainSourceBytes, probeSource, } from './source-bytes.js';
import { sourceKeyOf, stampMatches } from './source-stamp.js';
import { limitsFor, } from './types.js';
function resultOf(artifact, cacheKey, cached, stamp) {
    if (artifact.markdown.trim() === '') {
        throw new ZoteroError('MinerU returned empty Markdown', ZOTERO_ENRICHMENT_TASK_FAILED);
    }
    return {
        artifact,
        cacheKey,
        cached,
        stamp,
        provenance: {
            parser: 'mineru',
            mode: artifact.meta.mode,
            artifactId: cacheKey,
            fingerprint: artifact.meta.contentFingerprint,
            sourceId: artifact.meta.sourceId,
            generation: artifact.meta.generation,
        },
    };
}
/**
 * Acquire and parse one authorized PDF, or resume its generation's receipt.
 * Every failure is a stable ZoteroError except the caller's own abort reason.
 */
export async function parseDocument(input, deps, signal) {
    signal?.throwIfAborted();
    const wait = async (promise) => {
        const value = await promise;
        signal?.throwIfAborted();
        return value;
    };
    let publishing = false;
    try {
        let config;
        try {
            config = resolveEnrichmentConfig(deps.config);
        }
        catch (error) {
            throw new ZoteroError('Invalid enrichment configuration.', ZOTERO_INVALID_ARGUMENT, {
                cause: error,
            });
        }
        if (!isPdfCandidateContentType(input.contentType)) {
            throw new ZoteroError('Only PDF attachments are eligible for MinerU parsing', ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT);
        }
        if (!PARSE_GENERATION.safeParse(deps.generation).success) {
            throw new ZoteroError('A UUID parse generation is required.', ZOTERO_INVALID_ARGUMENT);
        }
        const identity = canonicalSourceIdentityOf(input.key);
        const sourceIdentity = canonicalSourceIdentityOf(input.source.kind === 'local' ? input.source.attachmentRef : input.source.url);
        if (identity !== sourceIdentity) {
            throw new ZoteroError('The document key does not match its source.', ZOTERO_INVALID_ARGUMENT);
        }
        const store = await wait(deps.store(config));
        const maxBytes = limitsFor(config.mode).maxBytes;
        const sourceKey = sourceKeyOf(identity);
        const byteDeps = {
            ...hostSourceBytesDeps(deps.resolveAttachment, deps.client),
            ...deps.sourceFiles,
        };
        // A different generation cannot reuse this index: force must really parse,
        // while retries of the same generation can answer before acquiring bytes.
        const record = await wait(store.sourceRecord(sourceKey));
        if (record !== undefined &&
            record.cacheKey ===
                cacheKeyOf({
                    identity,
                    generation: deps.generation,
                    mode: config.mode,
                    fingerprint: record.fingerprint,
                })) {
            const stamp = await wait(probeSource(input, maxBytes, byteDeps, signal));
            if (stampMatches(record.stamp, stamp)) {
                const artifact = await wait(store.artifactFor(record));
                if (artifact !== undefined)
                    return resultOf(artifact, record.cacheKey, true, stamp);
            }
        }
        // Resolve pro credentials before obtaining the document. Free mode never
        // reads them; a source-index hit above needs no credentials in either mode.
        let token;
        if (config.mode === 'pro') {
            const reference = config.mineruTokenRef.trim() || ENRICHMENT_CREDENTIAL_REFERENCE_NAMES.mineru;
            try {
                token = (await wait(deps.resolveToken(reference))).trim();
                if (token === '')
                    throw new Error('The resolved MinerU token is empty.');
            }
            catch (error) {
                signal?.throwIfAborted();
                if (error instanceof ZoteroError)
                    throw error;
                throw new ZoteroError('The MinerU credential could not be resolved.', ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED, { cause: error });
            }
        }
        deps.onProgress?.('acquiring');
        signal?.throwIfAborted();
        const source = await wait(obtainSourceBytes(input, maxBytes, byteDeps, signal));
        const fingerprint = source.stamp.kind === 'bytes' ? source.stamp.fingerprint : contentFingerprintOf(source.bytes);
        const parsed = await wait((deps.parse ?? parseOnce)({
            identity,
            generation: deps.generation,
            mode: config.mode,
            bytes: source.bytes,
            fingerprint,
            ...(token !== undefined ? { token } : {}),
            ...(signal !== undefined ? { signal } : {}),
            ...(deps.onProgress !== undefined ? { onProgress: deps.onProgress } : {}),
        }, { client: deps.client, store, flight: deps.flight }));
        const result = resultOf(parsed.artifact, parsed.cacheKey, parsed.cached, source.stamp);
        deps.onProgress?.('writing');
        signal?.throwIfAborted();
        // Publication is the commit boundary. Cancellation may prevent starting it;
        // after it starts, its actual filesystem outcome decides success or failure.
        // Only the actual acquisition can establish redirect aliases. Byte-only
        // callers and metadata never provide evidence for URL alias publication.
        const aliases = source.urlSource === undefined
            ? [sourceKey]
            : [
                sourceKey,
                sourceKeyOf(source.urlSource.requestedUrl),
                sourceKeyOf(source.urlSource.finalUrl),
            ];
        publishing = true;
        await store.putSources(aliases, {
            version: 2,
            cacheKey: parsed.cacheKey,
            fingerprint: parsed.artifact.meta.contentFingerprint,
            generation: parsed.artifact.meta.generation,
            parser: parsed.artifact.meta.parser,
            format: parsed.artifact.meta.format,
            stamp: source.stamp,
        }, signal);
        return result;
    }
    catch (error) {
        if (signal?.aborted && error === signal.reason)
            throw error;
        if (!publishing)
            signal?.throwIfAborted();
        if (error instanceof ZoteroError)
            throw error;
        throw new ZoteroError(`MinerU parsing failed: ${errorMessageOf(error)}`, ZOTERO_ENRICHMENT_TASK_FAILED, { cause: error });
    }
}
//# sourceMappingURL=parse-document.js.map