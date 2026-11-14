import type { ZoteroArtifactImageMediaType } from '../contract.js';
export { ZIP_MAX_TOTAL_ENTRIES, ZIP_MAX_WANTED_ENTRIES, ZIP_MAX_FILE_BYTES, ZIP_MAX_ARCHIVE_BYTES, } from './archive-limits.js';
export declare const ZIP_MAX_IMAGES = 512;
export declare const ZIP_MAX_IMAGE_BYTES: number;
export declare const ZIP_MAX_IMAGE_TOTAL_BYTES: number;
export interface ExtractedImage {
    readonly name: string;
    readonly mediaType: ZoteroArtifactImageMediaType;
    readonly data: Uint8Array;
}
declare const normalizedContentList: unique symbol;
export type NormalizedContentList = string & {
    readonly [normalizedContentList]: true;
};
export interface ExtractedParsedFiles {
    readonly markdown: string;
    readonly contentList?: NormalizedContentList;
    readonly images: readonly ExtractedImage[];
}
export declare class ArchiveValidationError extends Error {
    readonly code = "ZOTERO_ENRICHMENT_ARCHIVE_INVALID";
    constructor(reason: string);
}
export declare function extractParsedFiles(bytes: Uint8Array): ExtractedParsedFiles;
//# sourceMappingURL=zip.d.ts.map