/** One shared status request with an owned deadline and explicit retry after failure. */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroStatusView } from '../contract.ts'

export const STATUS_PROBE_TIMEOUT_MS = 30_000

export function createStatusProbe(
  read: (signal: AbortSignal) => Promise<RemoteResult<ZoteroStatusView>>,
  timeoutMs = STATUS_PROBE_TIMEOUT_MS,
) {
  let disposed = false
  let current:
    { controller: AbortController; task: Promise<RemoteResult<ZoteroStatusView>> } | undefined
  return {
    probe(): Promise<RemoteResult<ZoteroStatusView>> {
      if (disposed) return Promise.reject(new Error('Zotero status checks are stopped.'))
      if (current) return current.task
      const controller = new AbortController()
      let resolve!: (value: RemoteResult<ZoteroStatusView>) => void
      let reject!: (reason: unknown) => void
      const pending = new Promise<RemoteResult<ZoteroStatusView>>((accept, refuse) => {
        resolve = accept
        reject = refuse
      })
      const abort = () => reject(controller.signal.reason)
      controller.signal.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(
        () => controller.abort(new Error(`Zotero status check timed out after ${timeoutMs}ms.`)),
        timeoutMs,
      )
      const entry = {
        controller,
        task: pending.finally(() => {
          clearTimeout(timer)
          controller.signal.removeEventListener('abort', abort)
          if (current === entry) current = undefined
        }),
      }
      current = entry
      try {
        void read(controller.signal).then(resolve, reject)
      } catch (error) {
        reject(error)
      }
      return entry.task
    },
    dispose(): void {
      disposed = true
      current?.controller.abort(new Error('Zotero status checks are stopped.'))
    },
  }
}
