/**
 * The `local` provider facade: the Zotero Local API seam implementing
 * {@link ZoteroProvider}. Capabilities are declared only for what this
 * provider implements, so a capability gate can never route work into a
 * method that does not exist. Every domain pipeline lives beside it in
 * `local/*-domain.ts`; this class owns the wiring: the HTTP client, the
 * projected limits, and the scope directory whose caches rebuild with the
 * provider on every settings commit.
 *
 * Request-driven by design: loading never touches Zotero, and the only
 * health check is `status()`. Search semantics follow the Local API's
 * documented behavior (server-side paging over `/items/top`, client-side
 * scope-name resolution, literal tag escaping); first-page note-body
 * matches ride in `supplemental`, never inside the paged totals. The
 * provider keeps its limit projection live, so a limit-only settings edit
 * does not rebuild its transport or discard its scope caches.
 * @module dsh-zotero/local/provider
 */
import { readCollectionPath } from './collection-path.js';
import { LOCAL_PROVIDER_ID, ZOTERO_API_VERSION_HEADER, ZOTERO_LIBRARY_VERSION_HEADER, ZOTERO_SCHEMA_VERSION_HEADER, ZOTERO_VERSION_HEADER, } from '../constants.js';
import { serverIdFromHeaders } from './identity.js';
import { refStringFor, libraryPrefix, PERSONAL_LIBRARY } from '../refs.js';
import { readAllPages } from './pagination.js';
import { numericHeader } from './wire.js';
import { asRecord, asString } from '../json.js';
import { parentKeyOf, truncateText } from '../normalize-context.js';
import { normalizeSearchItem, parsedYearOf } from '../normalize-search.js';
import { formatCreatorsList } from '../creators.js';
import { fetchItemKeyBatches } from './item-batch.js';
import { fulltextIdentityOf } from './fulltext-identity.js';
import { ZOTERO_DIAGNOSIS_OK } from '../contract.js';
import { errorChain } from '@deepseek-ai/dsh-llm';
import { ZoteroError, ZOTERO_CAPABILITY_UNAVAILABLE, ZOTERO_PROVIDER_UNAVAILABLE, } from '../errors.js';
import { resolveCollectionsMixed, ScopeDirectory } from './scope-directory.js';
import { bm25EvidenceRanker } from './evidence-ranker.js';
import { runSearch } from './search-domain.js';
import { createSearchIndexCaches } from './search-index.js';
import { getItem as getItemDomain, getChildPage as getChildPageDomain } from './detail.js';
import { getBatch as getBatchDomain } from './get-batch-domain.js';
import { matchReferences as matchReferencesDomain } from './match-references-domain.js';
import { retrieve as retrieveDomain } from './retrieve.js';
import { getAttachmentLocation as attachmentLocationDomain } from './attachment-location.js';
import { createWslMountsMemo } from './path-resolution.js';
import { exportItems as exportItemsDomain, exportText as exportTextDomain, } from './export-domain.js';
import { changes as changesDomain } from './changes-domain.js';
import { discoverLibraries, runBrowse } from './browse-domain.js';
import { ItemSchemaDirectory } from './item-schema-directory.js';
import { createItem as createItemDomain, updateItem as updateItemDomain, writeCapabilityUnavailableMessage, } from './write-domain.js';
import { deleteLibraryTags as deleteLibraryTagsDomain, restoreItems as restoreItemsDomain, } from './write-library-maintenance.js';
import { createNote as createNoteDomain, updateNote as updateNoteDomain } from './write-notes.js';
import { updateItemCollections as updateItemCollectionsDomain, updateItemTags as updateItemTagsDomain, } from './write-item-lists.js';
import { batchItems as batchItemsDomain } from './write-batch.js';
import { preflightWrite as preflightWriteDomain } from './write-preflight.js';
import { createCollection as createCollectionDomain, deleteCollection as deleteCollectionDomain, updateCollection as updateCollectionDomain, } from './write-collections.js';
import { createSavedSearch as createSavedSearchDomain, updateSavedSearch as updateSavedSearchDomain, deleteSavedSearch as deleteSavedSearchDomain, } from './write-saved-searches.js';
export class LocalApiProvider {
    id = LOCAL_PROVIDER_ID;
    capabilities;
    client;
    writer;
    authorizer;
    readGrant;
    directory;
    itemSchema;
    getLimits;
    searchCaches;
    /** One memoized WSL mount-table read per provider instance. */
    wslMounts = createWslMountsMemo();
    sink;
    getFulltextEnhancer;
    getEvidenceRanker;
    constructor(options) {
        this.client = options.client;
        this.writer = options.writer;
        this.authorizer = options.authorizer;
        this.readGrant = options.readGrant;
        this.getLimits = options.limits;
        this.searchCaches = createSearchIndexCaches();
        this.sink = options.sink;
        this.getFulltextEnhancer = options.fulltextEnhancer ?? (() => undefined);
        this.getEvidenceRanker = options.evidenceRanker ?? (() => bm25EvidenceRanker);
        // The directory owns the scope-listing and breadcrumb caches. It reads the
        // TTL and the fan-out bound through the live limits, so a settings edit
        // changes how long an existing cache entry is trusted (and how wide a
        // collection-resolution fan-out may run) instead of rebuilding this
        // provider (and with it the HTTP client, the write client and the
        // authorizer's grants).
        this.directory = new ScopeDirectory(this.client, () => this.getLimits().scopeListingTtlMs, () => this.getLimits().graphConcurrency, this.sink);
        this.itemSchema = new ItemSchemaDirectory(this.client);
        // `write` is declared only when the write collaborators are wired: a
        // capability without its method would be a gate that routes into
        // nothing.
        this.capabilities = new Set([
            'metadata',
            'search',
            'attachments',
            'citation',
            'browse',
            'retrieve',
            'changes',
            ...(this.writer !== undefined && this.authorizer !== undefined ? ['write'] : []),
        ]);
    }
    /** One deps bundle per call keeps every domain signature explicit. */
    deps() {
        return {
            client: this.client,
            limits: this.getLimits(),
            searchCaches: this.searchCaches,
            sink: this.sink,
            // Read live per call: mounting or unmounting the enrichment row changes the
            // enhancer without rebuilding this provider.
            enhancer: this.getFulltextEnhancer(),
            // Same live read for the ranking strategy: the enrichment row swaps the
            // hybrid ranker in and out without a rebuild, and the core's own ranker is
            // the value while the row is absent.
            ranker: this.getEvidenceRanker(),
        };
    }
    /**
     * The write collaborators, asserted: the service only reaches the write
     * methods through the `write` capability gate, which this provider declares
     * exactly when both collaborators exist, so this assertion guards direct
     * provider callers, not the service path. Collection writes invalidate the
     * scope directory through the injected callback, so a renamed cache never
     * outlives the write that stale-dated it.
     */
    writeDeps() {
        if (this.writer === undefined || this.authorizer === undefined) {
            throw new ZoteroError(writeCapabilityUnavailableMessage(this.id), ZOTERO_CAPABILITY_UNAVAILABLE);
        }
        return {
            client: this.client,
            writer: this.writer,
            authorizer: this.authorizer,
            resolveCollection: (refOrName, signal) => this.resolveCollections([refOrName], signal).then((refs) => refs[0]),
            resolveCollections: (inputs, signal) => this.resolveCollections(inputs, signal),
            itemTypeFields: (itemType, signal) => this.itemSchema.getWritableItemFields(itemType, signal),
            onCollectionsChanged: () => this.directory.invalidate(PERSONAL_LIBRARY, 'collections'),
        };
    }
    /**
     * Resolve a mixed batch of collection refs and exact names, preserving
     * input order. The partition/ref-listing/name-resolution orchestration
     * lives once in `scope-directory.resolveCollectionsMixed`.
     */
    resolveCollections(inputs, signal) {
        return resolveCollectionsMixed(this.directory, inputs, PERSONAL_LIBRARY, signal, this.client.serverId);
    }
    /**
     * Probe `GET /api/` and report connectivity plus the instance identity
     * headers. Health checks live here, not on every tool call. An explicit
     * caller abort propagates instead of folding into `connected: false`, so a
     * cancel is never mistaken for a connectivity problem.
     */
    async status(signal) {
        try {
            const { headers } = await this.client.get('', undefined, { signal });
            const serverId = serverIdFromHeaders(headers);
            // The write block rides whenever the capability is on or a grant is
            // stored. The second half is wider than the write capability: with writes
            // disabled there is no authorizer (and so no write transport), but a
            // grant the user granted earlier stays stored, and the settings row must
            // be able to see it in order to revoke it. When neither holds, the block
            // is absent: no capability and nothing to revoke.
            const authorizer = this.authorizer;
            const grantReader = authorizer !== undefined
                ? (id) => authorizer.hasGrant(id)
                : this.readGrant;
            const enabled = this.capabilities.has('write');
            const authorized = grantReader === undefined ? false : await grantReader(serverId ?? '');
            const write = enabled || authorized ? { enabled, authorized } : undefined;
            return {
                providerId: this.id,
                // The authority this provider dialled, reported whether or not the
                // probe answered: when it did not, the address is what the user needs.
                endpoint: this.client.endpoint,
                connected: true,
                apiVersion: headers.get(ZOTERO_API_VERSION_HEADER) ?? undefined,
                serverId,
                schemaVersion: headers.get(ZOTERO_SCHEMA_VERSION_HEADER) ?? undefined,
                zoteroVersion: headers.get(ZOTERO_VERSION_HEADER) ?? undefined,
                ...(write !== undefined ? { write } : {}),
                diagnosis: ZOTERO_DIAGNOSIS_OK,
            };
        }
        catch (error) {
            if (signal?.aborted)
                throw error;
            // The code rides along in the diagnosis string so the model (and the
            // settings card) can route on it; routing still matches on the code,
            // never by parsing the message. Non-domain failures render their full
            // cause chain so a wrapped transport error is not reduced to its top
            // message.
            const diagnosis = error instanceof ZoteroError ? `${error.code}: ${error.message}` : errorChain(error);
            return {
                providerId: this.id,
                // The address that did not answer is exactly the fact a user needs to
                // check next, so the endpoint rides the failure arm too.
                endpoint: this.client.endpoint,
                connected: false,
                diagnosis,
            };
        }
    }
    /**
     * Discover candidates; the provider resolves scopes and serves the compact
     * records. The domain logic lives in `local/search-domain`; this method is
     * the provider seam that carries the client/limits/directory wiring.
     */
    async search(request, signal, options) {
        return runSearch(this.deps(), this.directory, request, signal, options);
    }
    /**
     * Diff the library against a local transaction version. The domain logic
     * lives in `local/changes-domain`; this is the seam.
     */
    async changes(request, signal, onProgress) {
        return changesDomain(this.deps(), request, signal, onProgress);
    }
    /**
     * Read one item's metadata plus optionally requested child content. The
     * domain logic lives in `local/detail`; this is the provider seam.
     */
    async getItem(request, signal) {
        return getItemDomain(this.deps(), this.directory, request, signal);
    }
    async parsedSearchAuthority(library, collectionKey, expected, signal) {
        const path = libraryPrefix(library) +
            (collectionKey === undefined ? '/collections' : `/collections/${collectionKey}`);
        const { headers } = await this.client.get(path, collectionKey === undefined ? new URLSearchParams({ limit: '1' }) : undefined, { signal, serverId: expected, sendServerId: false });
        const serverId = serverIdFromHeaders(headers);
        if (serverId === undefined || (expected !== undefined && serverId !== expected))
            throw new ZoteroError('Parsed library search requires the same identified Zotero database throughout the read.', ZOTERO_PROVIDER_UNAVAILABLE);
        return serverId;
    }
    async parsedSearchAttachment(ref, signal) {
        return await fulltextIdentityOf(this.client, ref, signal, true);
    }
    /** Enumerate PDFs and their parent metadata in one versioned library snapshot. */
    async parsePdfCatalog(library, signal) {
        const serverId = await this.parsedSearchAuthority(library, undefined, undefined, signal);
        const rows = new Map();
        const parentCounts = new Map();
        let listingVersion;
        const what = { body: 'PDF attachment listing', page: 'PDF attachment listing' };
        await readAllPages(this.client, `${libraryPrefix(library)}/items`, { itemType: 'attachment', sort: 'dateAdded', direction: 'asc' }, serverId, signal, what, undefined, (page, headers) => {
            listingVersion = numericHeader(headers, ZOTERO_LIBRARY_VERSION_HEADER);
            if (serverIdFromHeaders(headers) !== serverId || listingVersion === undefined)
                throw new ZoteroError('The Zotero PDF listing has no stable database identity or library version.', ZOTERO_PROVIDER_UNAVAILABLE);
            for (const row of page) {
                const item = asRecord(row);
                const data = asRecord(item?.data);
                if (data?.deleted || data?.itemType !== 'attachment')
                    continue;
                if (asString(data.contentType)?.split(';')[0]?.trim().toLowerCase() !== 'application/pdf')
                    continue;
                const key = asString(item?.key);
                if (key === undefined || !/^[A-Z0-9]{8}$/.test(key))
                    throw new ZoteroError('Zotero returned a PDF without a valid key.', ZOTERO_PROVIDER_UNAVAILABLE);
                const ref = refStringFor(library, 'attachment', key, serverId);
                if (rows.has(ref))
                    throw new ZoteroError('The Zotero PDF listing changed during paging.', ZOTERO_PROVIDER_UNAVAILABLE);
                const filename = asString(data.filename)?.trim();
                const title = asString(data.title)?.trim() || filename || key;
                const parentKey = parentKeyOf(data);
                rows.set(ref, { title, filename: filename || title, parentKey });
                if (parentKey !== undefined)
                    parentCounts.set(parentKey, (parentCounts.get(parentKey) ?? 0) + 1);
            }
        });
        const parents = await fetchItemKeyBatches({ client: this.client, limits: this.getLimits() }, library, [...parentCounts.keys()], {
            serverId,
            signal,
            requiredLibraryVersion: listingVersion,
            what: 'PDF parent metadata',
            onMissingKey: 'throw',
            mapRow: (row, key) => {
                const data = asRecord(asRecord(row)?.data);
                if (!parentCounts.has(key) || data?.deleted)
                    return undefined;
                const item = normalizeSearchItem(row, { library, serverId });
                const authors = item.authors?.length
                    ? formatCreatorsList(item.authors.map((name) => ({ name })))
                    : item.creatorSummary;
                return {
                    title: item.title.trim(),
                    authors: authors.trim(),
                    venue: item.venue?.trim(),
                    year: item.year ?? parsedYearOf(asString(data?.date)?.trim()),
                };
            },
        });
        await this.parsedSearchAuthority(library, undefined, serverId, signal);
        const clip = (value) => truncateText(value, 512).text;
        return [...rows].map(([ref, { title, filename, parentKey }]) => {
            const parent = parentKey === undefined ? undefined : parents.byKey.get(parentKey);
            return {
                ref,
                title: clip(parent?.title || title),
                ...(parent?.authors && { authors: clip(parent.authors) }),
                ...(parent?.venue && { venue: clip(parent.venue) }),
                ...(parent?.year !== undefined && { year: parent.year }),
                ...(parent?.title &&
                    parentKey !== undefined &&
                    (parentCounts.get(parentKey) ?? 0) > 1 && { fileLabel: clip(filename) }),
            };
        });
    }
    async parsePdfLibraries(signal) {
        return (await discoverLibraries(this.client, signal)).items;
    }
    async getBatch(request, signal) {
        const limits = this.getLimits();
        return getBatchDomain((item, itemSignal) => this.getItem(item, itemSignal), request, signal, Math.max(1, Math.min(limits.graphConcurrency, limits.maxInFlightRequests - 1)));
    }
    async matchReferences(request, signal) {
        return matchReferencesDomain({
            ...this.deps(),
            search: (searchRequest, searchSignal) => this.search(searchRequest, searchSignal, { includeSupplemental: false }),
        }, request, signal);
    }
    /** One paged child listing; the domain owns the ref/window/cap rules. */
    async getChildPage(request, signal) {
        return getChildPageDomain(this.deps(), request, signal);
    }
    /**
     * Resolve an item or attachment ref to a usable location. The domain
     * logic lives in `local/attachment-location`; this is the seam.
     */
    async getAttachmentLocation(ref, signal) {
        return attachmentLocationDomain({ ...this.deps(), pathResolution: { wslMounts: this.wslMounts } }, ref, signal);
    }
    async retrieve(request, signal, spill) {
        const deps = this.deps();
        return retrieveDomain(spill === undefined ? deps : { ...deps, spill }, request, signal);
    }
    /**
     * Export citations or formatted output for the requested items. The
     * domain logic lives in `local/export-domain`; this is the seam.
     */
    async export(request, signal, onProgress) {
        return exportItemsDomain(this.deps(), request, signal, onProgress);
    }
    /**
     * Export rendered text/citations for the requested items, without the
     * tool-side per-document itemization. The domain logic lives in
     * `local/export-domain`; this is the seam the library panel's endpoint uses.
     */
    async exportText(request, signal, onProgress) {
        return exportTextDomain(this.deps(), request, signal, onProgress);
    }
    /**
     * Read one collection's exact parent chain, fresh, under the caller's
     * library version. The path domain lives in `local/collection-path`; this
     * is the seam, and it rides the `browse` capability.
     */
    async collectionPath(request, signal) {
        return readCollectionPath(this.deps().client, request, signal);
    }
    /**
     * Discover libraries, collections, saved searches, tags, item types, and
     * metadata fields. The domain logic lives in `local/browse-domain`; this
     * is the seam.
     */
    async browse(request, signal) {
        return runBrowse(this.deps(), this.directory, this.itemSchema, request, signal);
    }
    /**
     * Create a research note (standalone, or a child note under a parent item)
     * with tags, collections, and source relations. The domain logic lives in
     * `local/write-notes`; this is the seam, and it is only reachable through
     * the `write` capability gate.
     */
    async createNote(request, signal) {
        return createNoteDomain(this.writeDeps(), request, signal);
    }
    /**
     * Update one item's tags (add/remove in one write). The domain logic lives
     * in `local/write-item-lists`; this is the seam.
     */
    async updateItemTags(request, signal) {
        return updateItemTagsDomain(this.writeDeps(), request, signal);
    }
    async updateNote(request, signal) {
        return updateNoteDomain(this.writeDeps(), request, signal);
    }
    /**
     * Update one item's collection membership (add/remove in one write). The
     * domain logic lives in `local/write-item-lists`; this is the seam.
     */
    async updateItemCollections(request, signal) {
        return updateItemCollectionsDomain(this.writeDeps(), request, signal);
    }
    async updateCollection(request, signal) {
        return updateCollectionDomain(this.writeDeps(), request, signal);
    }
    /**
     * Create a collection, optionally under a parent. The domain logic lives in
     * `local/write-collections`; this is the seam.
     */
    async createCollection(request, signal) {
        return createCollectionDomain(this.writeDeps(), request, signal);
    }
    async preflightWrite(request, signal) {
        await preflightWriteDomain(this.writeDeps(), request, signal);
    }
    /**
     * Delete a collection by ref or name. The domain logic lives in
     * `local/write-collections`; this is the seam.
     */
    async deleteCollection(request, signal) {
        return deleteCollectionDomain(this.writeDeps(), request, signal);
    }
    /**
     * Create a bibliographic item from the closed field set. The domain logic
     * lives in `local/write-domain`; this is the seam.
     */
    async createItem(request, signal) {
        return createItemDomain(this.writeDeps(), request, signal);
    }
    /**
     * Update one item's scalar metadata fields. The domain logic lives in
     * `local/write-domain`; this is the seam.
     */
    async updateItem(request, signal) {
        return updateItemDomain(this.writeDeps(), request, signal);
    }
    /**
     * Delete tags library-wide. The domain logic lives in
     * `local/write-library-maintenance`; this is the seam.
     */
    async deleteLibraryTags(request, signal) {
        return deleteLibraryTagsDomain(this.writeDeps(), request, signal);
    }
    /**
     * Batch items operation: create/import, update tags/collections, delete.
     */
    async batchItems(request, signal) {
        return batchItemsDomain(this.writeDeps(), request, signal);
    }
    async restoreItems(request, signal) {
        return restoreItemsDomain(this.writeDeps(), request, signal);
    }
    async createSavedSearch(request, signal) {
        return createSavedSearchDomain(this.writeDeps(), request, signal);
    }
    async updateSavedSearch(request, signal) {
        return updateSavedSearchDomain(this.writeDeps(), request, signal);
    }
    async deleteSavedSearch(request, signal) {
        return deleteSavedSearchDomain(this.writeDeps(), request, signal);
    }
}
//# sourceMappingURL=provider.js.map