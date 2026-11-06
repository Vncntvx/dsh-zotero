/**
 * Browser-lane stubs for the Client Remote surface: the access seam, the
 * mounted `remote.zotero` namespace, and a locale reader. They live here so
 * the shared apply world stays inside its frozen size budget.
 * @module tests/client/helpers/remote-stubs
 */

/**
 * A Client access seam fake: every action is granted by default (the owner); a
 * spec narrows the set to model a viewer without the grant.
 * @param granted - the action keys this Peer is granted.
 * @returns the `ctx.remoteAccess` surface the browser entry injects on.
 */
export function createRemoteAccessStub(granted: ReadonlySet<string>) {
  const owned = (callback: () => unknown) => {
    const dispose = callback()
    return typeof dispose === 'function' ? (dispose as () => void) : () => undefined
  }
  return {
    whenAccess: (action: string, callback: () => unknown) =>
      granted.has(action) ? owned(callback) : () => undefined,
    source: () => ({ getSnapshot: () => true, subscribe: () => () => undefined }),
    whenResourceAccess: (kind: string, id: string, action: string, callback: () => unknown) =>
      granted.has(`${kind}:${id}:${action}`) ? owned(callback) : () => undefined,
  }
}

/** The slice of the fake world the mounted `remote.zotero` namespace reads. */
export interface RemoteZoteroWorld {
  status(): unknown
  resolveAttachment(ref: string): unknown
  libraryWire: {
    browse(request: unknown): unknown
    search(request: unknown): unknown
    item(request: unknown): unknown
    childPage(request: unknown): unknown
    write(request: unknown): unknown
  }
  openProtocolCalls: string[]
  /** Scripted protocol-launch result; a spec sets it to model a refusal. */
  openProtocolOutcome?: () => unknown
}

/**
 * Switch the mounted namespace's protocol launcher to a refusal. The stub
 * reads the outcome on every call, so a spec can flip it after `applyEntry`
 * without reaching into `ctx` or casting the fake context.
 * @param world - the fake world backing the mounted namespace.
 */
export function failOpenProtocol(world: RemoteZoteroWorld): void {
  world.openProtocolOutcome = () => ({ ok: false as const, error: {} })
}

/**
 * The mounted `remote.zotero` namespace. A UI callback reads it through the
 * dotted form only on a fiber that declared `remote.zotero`, exactly as the
 * runtime writes it.
 * @param world - the fake world supplying the answers.
 * @returns the namespace the browser entry calls.
 */
export function createRemoteZoteroStub(world: RemoteZoteroWorld) {
  return {
    status: () => world.status(),
    resolveAttachment: (ref: string) => world.resolveAttachment(ref),
    browse: (request: unknown) => world.libraryWire.browse(request),
    search: (request: unknown) => world.libraryWire.search(request),
    item: (request: unknown) => world.libraryWire.item(request),
    childPage: (request: unknown) => world.libraryWire.childPage(request),
    write: (request: unknown) => world.libraryWire.write(request),
    diagnostics: async () =>
      ({
        ok: true as const,
        value: { entries: [], total: 0, truncated: false, debug: false },
      }) as unknown,
    reportClientError: async (report: { surface: string; message: string }) =>
      ({ ok: true as const, value: { seq: 1, report } }) as unknown,
    openProtocol: async (url: string) => {
      world.openProtocolCalls.push(url)
      return (
        world.openProtocolOutcome?.() ??
        ({ ok: true as const, value: { success: true as const } } as unknown)
      )
    },
  }
}
