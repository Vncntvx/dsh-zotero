/** Resource-tab inventory owns leases; durable metadata contains source refs only. */
import { z } from 'zod'
const CATALOG_KEY = 'dsh-zotero:url-pdf-readers:2'
const MAX_CATALOG_ROWS = 256
const catalogSchema = z
  .array(z.tuple([z.string(), z.object({ ref: z.string() }).strict()]))
  .max(MAX_CATALOG_ROWS)

export interface PdfReaderInventory {
  getSnapshot(): readonly { readonly contentId: string }[]
  subscribe(listener: () => void): () => void
}
export interface PdfReaderRegistry {
  track(address: string, lease: string, ref?: string): void
  /** Detach address/source metadata. The registry retains lease cleanup ownership until disposal. */
  forget(address: string): void
  source(address: string): string | undefined
  recoveryError(): unknown
  dispose(): Promise<void>
}
interface ReadingLease {
  readonly lease: string
  releasing?: Promise<void>
}
interface ReadingSource {
  readonly ref?: string
  opened: boolean
  read?: ReadingLease
}

export function createPdfReaderRegistry(port: {
  inventory: PdfReaderInventory
  release(lease: string): Promise<void>
  report(error: unknown): void
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
}): PdfReaderRegistry {
  const files = new Map<string, ReadingSource>()
  const owned = new Map<ReadingLease, string>()
  let storageError: unknown
  let closed = false
  let disposal: Promise<void> | undefined
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
    const rows = [...files].flatMap(([address, file]) =>
      file.ref ? [[address, { ref: file.ref }]] : [],
    )
    if (rows.length === 0) port.storage?.removeItem(CATALOG_KEY)
    else port.storage?.setItem(CATALOG_KEY, JSON.stringify(rows))
    storageError = undefined
  }
  const persistReported = () => {
    try {
      persist()
    } catch (error) {
      storageError = error
      port.report(error)
    }
  }
  const release = (address: string, file: ReadingLease, keepSource = false): Promise<void> => {
    if (file.releasing) return file.releasing
    const task = port.release(file.lease).then(
      () => {
        owned.delete(file)
        const current = files.get(address)
        // A retired lease settling later cannot remove its successor's source.
        if (current?.read === file) {
          if (keepSource) delete current.read
          else files.delete(address)
        }
        persistReported()
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
      else if (file.opened) {
        if (file.read) void release(address, file.read)
        else {
          files.delete(address)
          persistReported()
        }
      }
    }
  }
  const unsubscribe = port.inventory.subscribe(update)
  update()
  return {
    track(address, lease, ref) {
      if (closed) throw new Error('PDF reader registry is closed')
      const before = new Map(files)
      const previous = files.get(address)
      if (previous?.read?.lease === lease) return
      const read: ReadingLease = { lease }
      files.delete(address)
      files.set(address, { ref, read, opened: false })
      try {
        while (files.size > MAX_CATALOG_ROWS) {
          const stale = [...files].find(([, file]) => file.read === undefined)
          if (!stale) throw new Error('PDF reader source catalog is full')
          files.delete(stale[0])
        }
        persist()
      } catch (error) {
        files.clear()
        for (const [key, value] of before) files.set(key, value)
        throw error
      }
      owned.set(read, address)
      if (previous?.read) void release(address, previous.read)
      update()
    },
    forget(address) {
      if (!files.delete(address)) return
      persistReported()
    },
    source: (address) => files.get(address)?.ref,
    recoveryError: () => storageError,
    async dispose() {
      if (disposal) return await disposal
      closed = true
      unsubscribe()
      // Restored metadata carries no lease and never becomes this session's cleanup work.
      disposal = (async () => {
        await Promise.all([...owned].map(([file, address]) => release(address, file, true)))
        owned.clear()
        files.clear()
      })()
      await disposal
    },
  }
}
