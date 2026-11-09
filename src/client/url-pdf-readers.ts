import { z } from 'zod'
const CATALOG_KEY = 'dsh-zotero:url-pdf-readers:1'
const catalogSchema = z.array(
  z.tuple([z.string(), z.object({ lease: z.string(), ref: z.string() }).strict()]),
)

/** Reading file leases follow resource tabs, including hidden and floating tabs. */
export interface PdfReaderInventory {
  getSnapshot(): readonly { readonly contentId: string }[]
  subscribe(listener: () => void): () => void
}
/** The reading-file leases one registry owns. */
export interface PdfReaderRegistry {
  track(address: string, lease: string, ref?: string): void
  forget(address: string): void
  source(address: string): string | undefined
  recoveryError(): unknown
  dispose(): Promise<void>
}

export function createPdfReaderRegistry(port: {
  inventory: PdfReaderInventory
  release(lease: string): Promise<void>
  report(error: unknown): void
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
}): PdfReaderRegistry {
  const files = new Map<
    string,
    { lease: string; ref?: string; opened: boolean; releasing?: Promise<void> }
  >()
  let storageError: unknown
  try {
    const saved = port.storage?.getItem(CATALOG_KEY)
    if (saved)
      for (const [address, file] of catalogSchema.parse(JSON.parse(saved)))
        files.set(address, { ...file, opened: false })
  } catch (error) {
    storageError = error
    port.report(error)
  }
  const persist = () => {
    port.storage?.setItem(
      CATALOG_KEY,
      JSON.stringify(
        [...files].flatMap(([address, file]) =>
          file.ref ? [[address, { lease: file.lease, ref: file.ref }]] : [],
        ),
      ),
    )
    storageError = undefined
  }
  const release = (address: string, file: { lease: string; releasing?: Promise<void> }) => {
    if (file.releasing) return file.releasing
    const task = port.release(file.lease).then(
      () => {
        files.delete(address)
        try {
          persist()
        } catch (error) {
          port.report(error)
        }
      },
      (error: unknown) => {
        file.releasing = undefined
        port.report(error)
      },
    )
    file.releasing = task
    return task
  }
  const update = () => {
    const open = new Set(port.inventory.getSnapshot().map((tab) => tab.contentId))
    for (const [address, file] of files) {
      if (open.has(address)) file.opened = true
      else if (file.opened) void release(address, file)
    }
  }
  const unsubscribe = port.inventory.subscribe(update)
  update()
  return {
    track(address: string, lease: string, ref?: string) {
      files.set(address, { lease, ref, opened: false })
      try {
        persist()
      } catch (error) {
        files.delete(address)
        throw error
      }
      update()
    },
    forget(address: string) {
      if (!files.delete(address)) return
      try {
        persist()
      } catch (error) {
        port.report(error)
      }
    },
    source(address: string) {
      return files.get(address)?.ref
    },
    recoveryError() {
      return storageError
    },
    async dispose() {
      unsubscribe()
      // Retain source identities for restored tabs; temporary bytes still expire.
      // Reopening the browser never downloads them: the menu requires an explicit reload.
      await Promise.all(
        [...files.values()].map(async (file) => {
          if (file.releasing) await file.releasing
          else
            try {
              await port.release(file.lease)
            } catch (error) {
              port.report(error)
            }
        }),
      )
      files.clear()
    },
  }
}
