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
    read(attachment: ZoteroAttachmentLocationView, signal: AbortSignal): Promise<{
        ref: string;
        title: string;
        contentType: 'application/pdf';
        data: Uint8Array;
    }>;
}
//# sourceMappingURL=url-pdf.d.ts.map