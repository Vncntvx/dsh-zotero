/**
 * The export refs cap shared by both entry points.
 *
 * `zotero_export` (the model tool) and `zoteroLibrary.export` (the library
 * panel's endpoint) both hand a ref list to the export domain, and both must
 * refuse an over-cap list with the same message. The refusal itself is the
 * caller's: the tool rejects with `ToolArgsError`, the panel endpoint keeps
 * the stable `ZOTERO_INVALID_ARGUMENT`. The cap is live configuration
 * (`maxExportRefs`), so this module takes the resolved limit per call instead
 * of reading config; it owns only the wording.
 * @module dsh-zotero/export-limits
 */
/** The model-facing message for a refs list past the configured cap. */
export declare function exportRefsOverCapMessage(maxExportRefs: number, requested: number): string;
/**
 * Refuse a refs list past the configured `maxExportRefs` cap before any ref
 * parse or provider call.
 * @param requested - the ref count the caller supplied.
 * @param maxExportRefs - the live configured cap.
 * @param fail - the caller's typed argument refusal.
 */
export declare function assertExportRefsWithinCap(requested: number, maxExportRefs: number, fail: (message: string) => never): void;
//# sourceMappingURL=export-limits.d.ts.map