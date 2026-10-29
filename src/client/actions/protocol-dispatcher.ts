/**
 * Shared protocol dispatcher for browser components.
 * Configured during plugin UI registration from `ctx.remote.zotero`.
 * Dispatches a canonical zotero:// deep link to the host OS.
 * @module dsh-zotero/client/actions/protocol-dispatcher
 */

export type ProtocolDispatcher = (url: string) => Promise<boolean>

let activeDispatcher: ProtocolDispatcher | undefined

/**
 * Configure the active protocol dispatcher.
 * Pass `undefined` during fiber teardown.
 */
export function setProtocolDispatcher(dispatcher: ProtocolDispatcher | undefined): void {
  activeDispatcher = dispatcher
}

/**
 * Retrieve the active protocol dispatcher.
 */
export function getProtocolDispatcher(): ProtocolDispatcher | undefined {
  return activeDispatcher
}
