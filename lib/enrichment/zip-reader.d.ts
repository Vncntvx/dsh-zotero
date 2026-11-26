export interface ZipEntry {
    readonly name: string;
    readonly size: number;
    readonly compressedSize: number;
    readonly compression: number;
    readonly checksum: number;
    readonly offset: number;
}
/** Prove the central directory, local headers, data descriptors and byte ranges agree. */
export declare function readZipDirectory(bytes: Uint8Array): readonly ZipEntry[];
/** Inflate with an actual output cap, then verify both byte length and CRC. */
export declare function readZipEntry(bytes: Uint8Array, entry: ZipEntry, maxBytes: number): Uint8Array;
//# sourceMappingURL=zip-reader.d.ts.map