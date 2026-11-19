export declare const WRITE_PAYLOAD_MAX_BYTES = 1048576;
/** Count JSON in bounded chunks so an oversized field never requires a full encoded copy. */
export declare function assertWritePayload(value: unknown, maxChars?: number, noteMaxChars?: number): void;
/** The transport enforces the aggregate bound even for callers below the service seam. */
export declare function stringifyWriteBody(value: unknown): string;
//# sourceMappingURL=write-bounds.d.ts.map