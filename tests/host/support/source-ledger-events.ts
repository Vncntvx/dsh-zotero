/**
 * The committed session-event shape the literature-trail specs fold.
 *
 * Each spec owns one factory instance, so sequence numbers start at 1 inside
 * that spec and two specs can never interleave each other's event streams.
 * @module tests/host/support/source-ledger-events
 */

/**
 * Build one spec's event factory.
 * @returns `event(type, data)`, stamping the next sequence and its event time.
 */
export function createEventFactory<TEvent = never>(): (type: string, data: unknown) => TEvent {
  let seq = 0
  return (type: string, data: unknown): TEvent => {
    seq += 1
    return { type, seq, time: seq * 1000, data } as TEvent
  }
}
