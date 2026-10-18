/**
 * Three-state circuit breaker for scholarly API hosts.
 * Protects the system from stacking 429/503 delays on failing hosts.
 * @module dsh-zotero/scholarly/transport/circuit-breaker
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export class CircuitOpenError extends Error {
  constructor(
    public readonly host: string,
    public readonly cooldownRemainingMs: number,
  ) {
    super(
      `Circuit breaker is OPEN for ${host} due to repeated rate limiting. Cooldown remaining: ${Math.ceil(
        cooldownRemainingMs / 1000,
      )}s.`,
    )
    this.name = 'CircuitOpenError'
  }
}

interface HostCircuit {
  state: CircuitState
  consecutiveFailures: number
  lastFailureTime: number
  cooldownEndsAt: number
}

export interface CircuitBreakerOptions {
  failureThreshold?: number
  cooldownMs?: number
  windowMs?: number
  /** Observer for state changes; the transport records these in diagnostics. */
  onStateChange?: (host: string, from: CircuitState, to: CircuitState, reason?: string) => void
}

export class CircuitBreaker {
  private readonly circuits = new Map<string, HostCircuit>()
  private readonly failureThreshold: number
  private readonly cooldownMs: number
  private readonly windowMs: number
  private readonly onStateChange?: (
    host: string,
    from: CircuitState,
    to: CircuitState,
    reason?: string,
  ) => void

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3
    this.cooldownMs = options.cooldownMs ?? 60_000
    this.windowMs = options.windowMs ?? 60_000
    this.onStateChange = options.onStateChange
  }

  private getCircuit(host: string): HostCircuit {
    let circuit = this.circuits.get(host)
    if (!circuit) {
      circuit = {
        state: 'CLOSED',
        consecutiveFailures: 0,
        lastFailureTime: 0,
        cooldownEndsAt: 0,
      }
      this.circuits.set(host, circuit)
    }
    return circuit
  }

  getState(host: string): CircuitState {
    const circuit = this.getCircuit(host)
    const now = Date.now()

    if (circuit.state === 'OPEN' && now >= circuit.cooldownEndsAt) {
      this.transition(host, circuit, 'HALF_OPEN', 'Cooldown elapsed, probing host')
    }

    return circuit.state
  }

  private transition(host: string, circuit: HostCircuit, to: CircuitState, reason?: string): void {
    const from = circuit.state
    if (from === to) return
    circuit.state = to
    this.onStateChange?.(host, from, to, reason)
  }

  beforeRequest(host: string): void {
    const state = this.getState(host)
    const circuit = this.getCircuit(host)
    if (state === 'OPEN') {
      const remaining = Math.max(0, circuit.cooldownEndsAt - Date.now())
      throw new CircuitOpenError(host, remaining)
    }
  }

  recordSuccess(host: string): void {
    const circuit = this.getCircuit(host)
    if (circuit.state === 'HALF_OPEN' || circuit.consecutiveFailures > 0) {
      circuit.consecutiveFailures = 0
      this.transition(host, circuit, 'CLOSED', 'Host recovered with successful response')
    }
  }

  /**
   * Record one failed request.
   *
   * Every failure counts, not only 429/503: a host answering 500 for a minute,
   * or refusing connections, is exactly the host a breaker exists to rest. The
   * point of the breaker is to stop stacking waits on an unhealthy host, and
   * "unhealthy" is not limited to one status code.
   * @param host - the host that failed.
   * @param status - the HTTP status, or undefined for a transport-level failure.
   */
  recordFailure(host: string, status?: number): void {
    const circuit = this.getCircuit(host)
    const now = Date.now()

    if (circuit.state === 'HALF_OPEN') {
      // Half-open probe failed: immediately reopen circuit
      circuit.cooldownEndsAt = now + this.cooldownMs
      this.transition(host, circuit, 'OPEN', `Probe failed with HTTP ${status}`)
      return
    }

    if (now - circuit.lastFailureTime > this.windowMs) {
      circuit.consecutiveFailures = 0
    }

    circuit.lastFailureTime = now
    circuit.consecutiveFailures += 1

    if (circuit.consecutiveFailures >= this.failureThreshold) {
      circuit.cooldownEndsAt = now + this.cooldownMs
      this.transition(
        host,
        circuit,
        'OPEN',
        `Reached ${circuit.consecutiveFailures} consecutive failures${
          status === undefined ? '' : ` (last: HTTP ${status})`
        }`,
      )
    }
  }
}
