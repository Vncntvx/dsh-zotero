/** Canonical names and media types shared by extraction, persistence and wire codecs. */
import type { ZoteroArtifactImageMediaType } from './contract.js';
export declare const ARTIFACT_IMAGE_NAME_PATTERN: RegExp;
/** Resolve a Markdown destination without admitting nested or encoded escaping paths. */
export declare function artifactImageName(destination: string): string | undefined;
export declare function artifactImageMediaType(name: string): ZoteroArtifactImageMediaType | undefined;
export declare const ARCHIVE_MAX_IMAGES = 512;
export declare const ARCHIVE_MAX_IMAGE_BYTES: number;
export declare const ARCHIVE_MAX_IMAGE_TOTAL_BYTES: number;
//# sourceMappingURL=artifact-images.d.ts.map