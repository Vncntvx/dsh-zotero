import type { ZoteroArtifactImageMediaType } from '../contract.js';
export { ZIP_MAX_TOTAL_ENTRIES, ZIP_MAX_FILE_BYTES, ZIP_MAX_ARCHIVE_BYTES, } from './archive-limits.js';
interface ExtractedImage {
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
export declare function extractParsedFiles(bytes: Uint8Array): ExtractedParsedFiles;
//# sourceMappingURL=zip.d.ts.map