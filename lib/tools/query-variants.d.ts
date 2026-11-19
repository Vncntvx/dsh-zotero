/**
 * The `queryVariants` argument both ranking tools accept: one owner for the
 * bound and normalization. Duplicates fold rather than reject; entries beyond
 * the cap are refused because each phrasing scores the same passages again, so
 * splitting the call would only add work.
 * @module dsh-zotero/tools/query-variants
 */
/**
 * The message for more paraphrases than one call may carry.
 * @param cap - the per-call bound.
 * @returns the model-facing message.
 */
export declare function queryVariantsOverCapMessage(cap: number): string;
/**
 * Normalize the paraphrase list: trimmed, blank entries refused, duplicates
 * dropped.
 * @param variants - the raw argument list, when supplied.
 * @returns the distinct phrasings, or `undefined` when none were supplied.
 */
export declare function queryVariantsOf(variants: readonly string[] | undefined): string[] | undefined;
//# sourceMappingURL=query-variants.d.ts.map