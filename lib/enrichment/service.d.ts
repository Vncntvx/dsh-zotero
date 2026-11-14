/**
 * Cordis Service plugin providing `ctx.enrichment`.
 *
 * The component registers no model tools, prompt section, or skill. Ordinary
 * read tools consume committed artifacts through a read-only FulltextEnhancer.
 * Explicit enrichment jobs own document acquisition and MinerU submission.
 *
 * **Dependency direction.** enrichment → core. The core defines the pure
 * `FulltextEnhancer` type and holds an optional slot; enrichment imports that
 * type and installs itself. The core never imports `src/enrichment/**`, owns no
 * MinerU transport, host table, or credentials, and keeps its loopback path
 * byte-for-byte unchanged when the slot is empty.
 *
 * **Cache before bytes.** `lookup` checks the source index before probing a
 * local attachment with stat or an indexed URL with HEAD. A hit only reads
 * local artifacts. The active-parse domain re-checks remote access, the
 * session, and the user's explicit submission of the one target before any
 * source probe or document acquisition; mounting the component is what
 * authorizes egress at all.
 *
 * **Failures propagate.** Configuration, authorization, source, protocol,
 * task, archive, and storage failures are explicit errors. The output path
 * is resolved before any document bytes are obtained or uploaded.
 * @module dsh-zotero/enrichment/service
 */
import { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { ZoteroSemanticModelStatusRequestView, ZoteroSemanticModelStatusResultView, ZoteroSemanticModelDownloadRequestView, ZoteroSemanticModelDownloadResultView, ZoteroSemanticModelCancelRequestView, ZoteroSemanticModelCancelResultView, ZoteroSemanticModelDeleteRequestView, ZoteroSemanticModelDeleteResultView, ZoteroSemanticModelVerifyRequestView, ZoteroStartDocumentParseRequestView, ZoteroStartDocumentParseResultView, ZoteroDocumentArtifactRequestView, ZoteroDocumentArtifactResultView, ZoteroDocumentParseReceiptRequestView, ZoteroDocumentParseReceiptResultView, ZoteroListParsedDocumentsRequestView, ZoteroListParsedDocumentsResultView, ZoteroDiscardParsedDocumentRequestView, ZoteroDiscardParsedDocumentResultView } from '../contract.js';
import { type EnrichmentPreferences } from '../enrichment-preferences.js';
import { type FulltextEnhancer } from '../local/fulltext-enhancer.js';
import { type EnrichmentConfig } from './config.js';
import { MineruClient } from './transport.js';
import { ParsedArtifactStore } from './artifact-store.js';
import { ParseFlight, type parseOnce } from './parse-once.js';
import { type ParseJobPersistence } from './parse-jobs.js';
import { ModelDownloadManager } from './model-downloader.js';
import { SemanticEmbedderLoader } from './semantic/loader.js';
import { type EvidenceRanker } from '../local/evidence-ranker.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        enrichment: EnrichmentService;
    }
}
/** Host seams, injectable so a spec never opens a socket or writes to disk. */
export interface EnrichmentServiceDeps {
    readonly client?: MineruClient;
    readonly parse?: typeof parseOnce;
    readonly store?: (config: EnrichmentPreferences, create: boolean) => Promise<ParsedArtifactStore>;
    readonly flight?: ParseFlight;
    readonly parsePersistence?: ParseJobPersistence;
    /** The model-asset manager; tests inject a scripted one. */
    readonly downloads?: ModelDownloadManager;
    /** The semantic loader factory; tests inject one with a controlled `open`. */
    readonly loader?: () => SemanticEmbedderLoader;
}
export declare class EnrichmentService extends TypertRemoteService {
    config: EnrichmentConfig;
    static readonly Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        artifactReader: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
            [k: string]: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            [k: string]: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>>, "volatile-defined">;
        mode: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        mineruTokenRef: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        outputDir: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        enableSemanticSearch: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        semanticModel: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        semanticDownloadSource: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        semanticModelDir: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        artifactReader: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
            [k: string]: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            [k: string]: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>>, "volatile-defined">;
        mode: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        mineruTokenRef: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        outputDir: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        enableSemanticSearch: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        semanticModel: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        semanticDownloadSource: import("@deepseek-ai/schemastery").default<string | number, string | number, "volatile-defined">;
        semanticModelDir: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
    }>>, "plain">;
    private readonly client;
    private readonly storeFactory;
    private readonly resolveAttachment;
    private readonly parsing;
    private readonly management;
    /** The enhancer installed into the core. Stable identity for cleanup. */
    readonly enhancer: FulltextEnhancer;
    /** The resident embedder holder: one model at a time, released on disposal. */
    private loader;
    /** The model-asset manager: status, download, cancel, verify, per service. */
    private readonly downloads;
    /** One bounded vector cache per model identity, ref-counted by admitted scopes. */
    private vectorCache;
    /** Builds one loader per core-injection generation; tests inject a controlled one. */
    private readonly loaderFactory;
    /**
     * The ranker installed into the core. It reads the live config on every
     * call: disabled, it *is* the core's lexical ranker; enabled, it is the
     * hybrid one over the selected model, and a model that cannot serve fails
     * the call rather than degrading silently.
     */
    readonly liveEvidenceRanker: EvidenceRanker;
    constructor(ctx: Context, config?: EnrichmentConfig, deps?: EnrichmentServiceDeps);
    /**
     * Retire a cache generation. Disposal waits for its last scope: the generation
     * is what an admitted `rank()` reads, and disposing it on a switch gave that
     * call a retired cache and a bare `Error`.
     */
    private maybeDisposeCacheGeneration;
    /** One admitted scope finished with this generation. */
    private releaseCacheGeneration;
    /**
     * The generation a new admission runs against, created on an identity change.
     * The previous one is retired, not disposed: its admitted scopes still read it.
     */
    private acquireCacheGeneration;
    /** Teardown and model deletion: no new admission may reuse the current cache. */
    private retireActiveCache;
    /** Parsing endpoints retain the current invocation context for action/session checks. */
    startDocumentParse(request: ZoteroStartDocumentParseRequestView, signal: AbortSignal): Promise<ZoteroStartDocumentParseResultView>;
    documentArtifact(request: ZoteroDocumentArtifactRequestView, signal: AbortSignal): Promise<ZoteroDocumentArtifactResultView>;
    documentParseReceipt(request: ZoteroDocumentParseReceiptRequestView, signal: AbortSignal): Promise<ZoteroDocumentParseReceiptResultView>;
    listParsedDocuments(request: ZoteroListParsedDocumentsRequestView, signal: AbortSignal): Promise<ZoteroListParsedDocumentsResultView>;
    discardParsedDocument(request: ZoteroDiscardParsedDocumentRequestView, signal: AbortSignal): Promise<ZoteroDiscardParsedDocumentResultView>;
    /** The model endpoints live here, on the component: unmounting the row
     * removes the egress capability along with it, exactly like the MinerU
     * authorization. Request fields override the committed settings; omitted
     * fields resolve from live config. A schema refusal is a model-facing
     * invalid argument, not an internal error. */
    private parseWire;
    semanticModelStatus(request: ZoteroSemanticModelStatusRequestView, signal: AbortSignal): Promise<ZoteroSemanticModelStatusResultView>;
    downloadSemanticModel(request: ZoteroSemanticModelDownloadRequestView, signal: AbortSignal): Promise<ZoteroSemanticModelDownloadResultView>;
    cancelSemanticModelDownload(request: ZoteroSemanticModelCancelRequestView, signal: AbortSignal): Promise<ZoteroSemanticModelCancelResultView>;
    deleteSemanticModel(request: ZoteroSemanticModelDeleteRequestView, signal: AbortSignal): Promise<ZoteroSemanticModelDeleteResultView>;
    verifySemanticModel(request: ZoteroSemanticModelVerifyRequestView, signal: AbortSignal): Promise<ZoteroSemanticModelStatusResultView>;
    /**
     * Directory validation belongs to the accepted snapshot and is repeated on
     * every operation. One store instance is kept per resolved root, so its
     * per-generation caches (index snapshot, inventory) survive across calls.
     */
    private resolvedStore;
    private storeFor;
    private displayCandidate;
    /** One composition per accepted snapshot: the store and its source seams. */
    private metadataDeps;
    /**
     * Read a stored artifact when the source has not changed. This arm never
     * obtains document bytes and never contacts MinerU; a local source is
     * `stat`ed and an indexed URL gets one HEAD. Selection is independent of
     * the currently configured parsing mode.
     */
    private lookup;
}
export default EnrichmentService;
//# sourceMappingURL=service.d.ts.map