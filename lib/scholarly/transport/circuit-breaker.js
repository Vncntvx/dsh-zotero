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
import { isScholarlyHost } from './hosts.js';
export class ScholarlyCircuitOpenError extends Error {
    host;
    cooldownRemainingMs;
    constructor(host, cooldownRemainingMs) {
        super(`${host} is temporarily unavailable after repeated failures (${Math.ceil(cooldownRemainingMs / 1_000)}s remaining).`);
        this.host = host;
        this.cooldownRemainingMs = cooldownRemainingMs;
        this.name = 'ScholarlyCircuitOpenError';
    }
}
export class CircuitBreaker {
    circuits = new Map();
    failureThreshold;
    cooldownMs;
    windowMs;
    maxTrackedCircuits;
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold ?? 3;
        this.cooldownMs = options.cooldownMs ?? 60_000;
        this.windowMs = options.windowMs ?? 60_000;
        this.maxTrackedCircuits = options.maxTrackedCircuits ?? 200;
    }
    pruneDynamicCircuits() {
        if (this.circuits.size <= this.maxTrackedCircuits)
            return;
        const now = Date.now();
        // Phase 1: Prune dynamic circuits that are healthy or whose failures/cooldown have expired
        for (const [h, c] of this.circuits.entries()) {
            if (isScholarlyHost(h))
                continue;
            const isHealthy = c.state === 'CLOSED' && c.consecutiveFailures === 0;
            const isExpired = now - c.lastFailureTime > this.windowMs && now >= c.cooldownEndsAt;
            if (isHealthy || isExpired) {
                this.circuits.delete(h);
            }
        }
        // Phase 2: If still above capacity, evict dynamic hosts by oldest activity
        if (this.circuits.size > this.maxTrackedCircuits) {
            const dynamicEntries = [];
            for (const [h, c] of this.circuits.entries()) {
                if (!isScholarlyHost(h))
                    dynamicEntries.push([h, c]);
            }
            dynamicEntries.sort((a, b) => a[1].lastFailureTime - b[1].lastFailureTime);
            const toEvict = this.circuits.size - this.maxTrackedCircuits;
            for (let i = 0; i < toEvict && i < dynamicEntries.length; i++) {
                this.circuits.delete(dynamicEntries[i][0]);
            }
        }
    }
    getCircuit(host) {
        let circuit = this.circuits.get(host);
        if (!circuit) {
            this.pruneDynamicCircuits();
            circuit = {
                state: 'CLOSED',
                consecutiveFailures: 0,
                lastFailureTime: 0,
                cooldownEndsAt: 0,
            };
            this.circuits.set(host, circuit);
        }
        return circuit;
    }
    getState(host) {
        const circuit = this.getCircuit(host);
        const now = Date.now();
        if (circuit.state === 'OPEN' && now >= circuit.cooldownEndsAt) {
            // Cooldown elapsed, probing host.
            this.transition(circuit, 'HALF_OPEN');
        }
        return circuit.state;
    }
    transition(circuit, to) {
        if (circuit.state === to)
            return;
        circuit.state = to;
    }
    beforeRequest(host) {
        const state = this.getState(host);
        const circuit = this.getCircuit(host);
        if (state === 'OPEN') {
            const remaining = Math.max(0, circuit.cooldownEndsAt - Date.now());
            throw new ScholarlyCircuitOpenError(host, remaining);
        }
    }
    recordSuccess(host) {
        const circuit = this.getCircuit(host);
        if (circuit.state === 'HALF_OPEN' || circuit.consecutiveFailures > 0) {
            circuit.consecutiveFailures = 0;
            // Host recovered with successful response.
            this.transition(circuit, 'CLOSED');
        }
        // A healthy ad-hoc host has no reason to stay in memory indefinitely.
        if (!isScholarlyHost(host) && circuit.state === 'CLOSED' && circuit.consecutiveFailures === 0) {
            this.circuits.delete(host);
        }
    }
    /**
     * Record one failed request.
     *
     * Every failure counts, not only 429 and 503. A host answering 500 for a
     * minute, or refusing connections, is exactly the host a breaker exists to
     * rest: the point is to stop stacking waits on an unhealthy host, and
     * "unhealthy" is not limited to one status code.
     * @param host - the host that failed.
     */
    recordFailure(host) {
        const circuit = this.getCircuit(host);
        const now = Date.now();
        if (circuit.state === 'HALF_OPEN') {
            // Half-open probe failed: immediately reopen circuit.
            circuit.cooldownEndsAt = now + this.cooldownMs;
            this.transition(circuit, 'OPEN');
            return;
        }
        if (now - circuit.lastFailureTime > this.windowMs) {
            circuit.consecutiveFailures = 0;
        }
        circuit.lastFailureTime = now;
        circuit.consecutiveFailures += 1;
        if (circuit.consecutiveFailures >= this.failureThreshold) {
            circuit.cooldownEndsAt = now + this.cooldownMs;
            // Reached the failure threshold (last failure's status, when it has
            // one, is the failure the caller already carries).
            this.transition(circuit, 'OPEN');
        }
    }
}
//# sourceMappingURL=circuit-breaker.js.map