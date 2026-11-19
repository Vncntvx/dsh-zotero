/**
 * Bounded walk of an error's cause chain.
 *
 * `Error.cause` and `AggregateError.errors` can nest, cycle, and fan out. Both
 * `errnoCodeOf` (`errors.ts`) and the public-address rejection lookup
 * (`public-url.ts`) need the same walk, so the bound lives here once: a node
 * budget, a separate chain-depth budget for `cause` links, and a fan-out cap
 * for aggregate members. A `seen` set makes a cyclic cause harmless.
 * @module dsh-zotero/cause-chain
 */
/**
 * Walk the cause chain breadth-first and return the first value a visitor
 * accepts. A visitor returns `undefined` to keep walking; any other value ends
 * the walk, so a caller that wants a boolean produces `true` explicitly.
 * @param error - any thrown value.
 * @param visit - classify one node; `undefined` means "keep looking".
 * @returns the accepted value, or undefined when the bounded walk ends.
 */
export declare function findInCauseChain<T>(error: unknown, visit: (current: object) => T | undefined): T | undefined;
//# sourceMappingURL=cause-chain.d.ts.map