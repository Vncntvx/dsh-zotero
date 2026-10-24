/**
 * Three-state circuit breaker for scholarly API hosts.
 * Protects the system from stacking 429/503 delays on failing hosts.
 *
 * State changes are observable through {@link CircuitBreaker.getState}
 * alone. The scholarly transport deliberately carries no diagnostics
 * channel: the plugin's ring belongs to the `zotero` namespace (the
 * scholarly row is isolated from `ctx.zotero` by design, `docs/architecture.md`),
 * a rate-limited or open host already reaches the model as an unanswered
 * source, and an observer with no composed sink was a seam nothing read.
 * @module dsh-zotero/scholarly/transport/circuit-breaker
 */
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export declare class ScholarlyCircuitOpenError extends Error {
    readonly host: string;
    readonly cooldownRemainingMs: number;
    constructor(host: string, cooldownRemainingMs: number);
}
interface CircuitBreakerOptions {
    failureThreshold?: number;
    cooldownMs?: number;
    windowMs?: number;
    maxTrackedCircuits?: number;
}
export declare class CircuitBreaker {
    private readonly circuits;
    private readonly failureThreshold;
    private readonly cooldownMs;
    private readonly windowMs;
    private readonly maxTrackedCircuits;
    constructor(options?: CircuitBreakerOptions);
    private pruneDynamicCircuits;
    private getCircuit;
    getState(host: string): CircuitState;
    private transition;
    beforeRequest(host: string): void;
    recordSuccess(host: string): void;
    /**
     * Record one failed request.
     *
     * Every failure counts, not only 429 and 503. A host answering 500 for a
     * minute, or refusing connections, is exactly the host a breaker exists to
     * rest: the point is to stop stacking waits on an unhealthy host, and
     * "unhealthy" is not limited to one status code.
     * @param host - the host that failed.
     */
    recordFailure(host: string): void;
}
export {};
//# sourceMappingURL=circuit-breaker.d.ts.map