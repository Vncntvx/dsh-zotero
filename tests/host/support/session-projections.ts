/**
 * The projection-registration specs' one stub registry: a `sessionProjections`
 * service whose `register` defers to the caller's outcome, so the Zotero
 * service's registration states (ready, deferred-ready, failed) are driven
 * from one place instead of three drifting class copies.
 * @module tests/host/support/session-projections
 */

import { Context, Service } from '@deepseek-ai/cordis'

/** The projection handle shape the registry returns once a registration lands. */
export function projectionHandle(): unknown {
  return { stateOf: () => ({}), dispose: async () => {} }
}

/**
 * Mount a stub projection registry on the host context.
 * @param ctx - the host context to provide `sessionProjections` on.
 * @param register - the registration outcome the stub serves; it receives the
 *   definition the Zotero service registers. Defaults to an immediate ready.
 * @returns the definitions registered so far, for callers that assert keys.
 */
export function stubProjections(
  ctx: Context,
  register: (definition: { key: string }) => Promise<unknown> = () =>
    Promise.resolve(projectionHandle()),
): Array<{ key: string }> {
  const registered: Array<{ key: string }> = []
  class StubProjections extends Service {
    constructor(host: Context) {
      super(host, 'sessionProjections')
    }
    register(definition: { key: string }): Promise<unknown> {
      registered.push(definition)
      return register(definition)
    }
  }
  new StubProjections(ctx)
  return registered
}
