/** Literal user values in approval documents never introduce plan syntax. */
export declare function planValue(value: unknown): string;
/** A complete literal payload; authored backticks cannot terminate its fence. */
export declare function planBlock(value: unknown): string;
export declare const WRITE_AUTHORIZATION_PLAN_LINE = "Zotero may ask for a single-use or persistent authorization. Independent objects share native batches of at most 50; dependent children settle before parents. Each request spends one single-use grant. Prompts share a five-per-minute budget and may wait for capacity; cancelling stops further requests. The approved operation has a 15-minute deadline. Completed or unverified writes are never retried.";
//# sourceMappingURL=write-plan.d.ts.map