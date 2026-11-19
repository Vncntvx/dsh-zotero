/** All export formats count the same unique item identities; never silently deduplicate. */
export function assertUniqueExportRefs(refs, fail) {
    const seen = new Set();
    for (const ref of refs) {
        const identity = `${ref.library.type}/${ref.library.id}/item/${ref.key}`;
        if (seen.has(identity))
            fail(`refs must be unique; duplicate item: zotero://${identity}`);
        seen.add(identity);
    }
}
/** The model-facing message for a refs list past the configured cap. */
export function exportRefsOverCapMessage(maxExportRefs, requested) {
    return `refs must list at most ${maxExportRefs} item refs per call; got ${requested}; export in batches`;
}
/**
 * Refuse a refs list past the configured `maxExportRefs` cap before any ref
 * parse or provider call.
 * @param requested - the ref count the caller supplied.
 * @param maxExportRefs - the live configured cap.
 * @param fail - the caller's typed argument refusal.
 */
export function assertExportRefsWithinCap(requested, maxExportRefs, fail) {
    if (requested > maxExportRefs)
        fail(exportRefsOverCapMessage(maxExportRefs, requested));
}
//# sourceMappingURL=export-limits.js.map