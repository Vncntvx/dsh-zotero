/**
 * The `zotero_attachment` domain: resolving an item or attachment ref to a
 * verified on-disk path or a protocol-checked linked URL, via Zotero's own
 * best-attachment choice with the deterministic PDF fallback.
 * @module dsh-zotero/local/attachment-location
 */
import type { ZoteroHttpClient } from '../http-client.js';
import type { LocalApiLimits } from './limits.js';
import type { ZoteroAttachmentLocation, ZoteroObjectRef } from '../types.js';
/** Shown when a reported file location cannot be expressed as a local path. */
export declare const NOT_A_LOCAL_PATH_MESSAGE = "Zotero reported an attachment file location that is not a usable local path.";
/** The model-facing message for a location whose protocol the caller cannot open. */
export declare function unsupportedAttachmentProtocolMessage(protocol: string, allowedProtocols: readonly string[]): string;
/** The model-facing message for a linked-URL attachment Zotero left without a URL. */
export declare function missingLinkedUrlMessage(key: string): string;
/** The model-facing message for a linked-URL attachment whose URL is not a web location. */
export declare function notAWebLocationMessage(key: string): string;
/** The model-facing message for a file attachment whose reported location is unusable. */
export declare function noUsableFileLocationMessage(key: string): string;
/** The model-facing message for an attachment whose file is gone from disk. */
export declare function missingAttachmentFileMessage(path: string): string;
/** The model-facing message for a target that is a different item type than the ref claims. */
export declare function attachmentTypeMessage(itemType: string): string;
/** The model-facing message for an item ref with no attachment of any kind to resolve. */
export declare function noAttachmentToResolveMessage(key: string): string;
/**
 * Resolve an item or attachment ref to a usable location. An item ref
 * follows Zotero's own best-attachment link first and falls back to the
 * earliest PDF child, so callers do not need the attachment's key when
 * one attachment is enough. Linked-URL attachments carry their target in
 * `data.url` (their `/file/view/url` endpoint rejects non-file
 * attachments); file attachments resolve through `/file/view/url` and
 * are stat'ed so a missing file fails with a typed error instead of a
 * dead path.
 */
export declare function getAttachmentLocation(deps: {
    client: ZoteroHttpClient;
    limits: LocalApiLimits;
}, ref: ZoteroObjectRef, signal?: AbortSignal): Promise<ZoteroAttachmentLocation>;
//# sourceMappingURL=attachment-location.d.ts.map