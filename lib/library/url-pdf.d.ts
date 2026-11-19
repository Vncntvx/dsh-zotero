import { type AddressResolver, type PinnedDispatcher, type ResolvedAddress } from '../transport/network.js';
import type { PublicFetch } from '../transport/connections.js';
import type { ZoteroAttachmentLocationView } from '../contract.js';
export declare const URL_PDF_MAX_BYTES: number;
export declare const URL_PDF_TIMEOUT_MS = 60000;
export interface UrlPdfDependencies {
    readonly allowed: () => boolean;
    readonly resolver: AddressResolver;
    readonly dispatcher: (addresses: readonly ResolvedAddress[]) => PinnedDispatcher;
    readonly fetch: PublicFetch;
}
export declare class UrlPdfReader {
    private readonly deps;
    private readonly running;
    constructor(deps: UrlPdfDependencies);
    revoke(): void;
    /**
     * Stop every in-flight download because the capability itself is going
     * away (the plugin unmounted). The read's own catch treats an aborted
     * controller as the caller's verdict and rethrows this reason, so teardown
     * does not wait out a download's remaining deadline.
     */
    dispose(): void;
    read(attachment: ZoteroAttachmentLocationView, signal: AbortSignal): Promise<{
        ref: string;
        title: string;
        contentType: 'application/pdf';
        data: Uint8Array;
    }>;
}
//# sourceMappingURL=url-pdf.d.ts.map