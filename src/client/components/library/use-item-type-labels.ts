/**
 * One bounded read of Zotero's item-type schema, shared by every panel surface
 * that names an item type: the filter rail's menu, the list rows, and the
 * inspector's eyebrow. The listing is static per Zotero instance, so the panel
 * reads it once above the panes — the rail used to own this walk and repeated
 * it on every scope change, because the rail remounts with the scope key.
 * @module dsh-zotero/client/components/library/use-item-type-labels
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { LibraryFeedFace } from './library-feed-types.ts'
import { LIBRARY_PAGE_SIZE } from './library-model.ts'
import { messageOf } from '../../error-text.ts'

/** One item-type row: the camelCase schema name and Zotero's localized name. */
interface ItemTypeRow {
  readonly itemType: string
  readonly localized?: string
}

/** The vocabulary the panel's surfaces share. */
export interface ItemTypeVocabulary {
  /** The listing in the order Zotero serves it; the filter menu renders this. */
  readonly rows: readonly ItemTypeRow[]
  /** Zotero's localized names keyed by schema name; empty while unread or failed. */
  readonly localized: Readonly<Record<string, string>>
  /** The read's failure message; the rail surfaces it with its retry action. */
  readonly error?: string
  /** Re-run the walk after a failure. */
  readonly retry: () => void
}

/** The value a failed or not-yet-read walk yields: no names, no fallback. */
const NO_LOCALIZED_NAMES: Readonly<Record<string, string>> = {}

/**
 * Read the whole item-type listing once per enabled face.
 * @param face - the panel's wire face.
 * @param t - the panel's translator (the stalled-cursor message).
 * @param enabled - whether the panel may read the wire.
 * @returns the listing, Zotero's localized names, and a retry action.
 */
export function useItemTypeVocabulary(
  face: LibraryFeedFace,
  t: TranslateNS<'zotero'>,
  enabled: boolean,
): ItemTypeVocabulary {
  const [rows, setRows] = useState<readonly ItemTypeRow[]>([])
  const [error, setError] = useState<string>()
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let active = true
    setError(undefined)
    void (async () => {
      const collected: ItemTypeRow[] = []
      let offset = 0
      for (;;) {
        const result = await face.browse(
          { kind: 'itemTypes', offset, limit: LIBRARY_PAGE_SIZE },
          controller.signal,
        )
        if (!active) return
        if (!result.ok) {
          setError(result.error.message)
          return
        }
        for (const row of result.value.items) {
          if (row.kind !== 'itemType') continue
          collected.push({
            itemType: row.itemType,
            ...(row.localized !== undefined ? { localized: row.localized } : {}),
          })
        }
        const next = result.value.nextOffset
        if (next === undefined) break
        if (next <= offset) {
          setError(t('libraryInvalidPage'))
          return
        }
        offset = next
      }
      if (active) setRows(collected)
    })().catch((cause: unknown) => {
      if (active) setError(messageOf(cause))
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [face, enabled, retryToken, t])

  const localized = useMemo(() => {
    if (rows.length === 0) return NO_LOCALIZED_NAMES
    const names: Record<string, string> = {}
    for (const row of rows) {
      if (row.localized !== undefined) names[row.itemType] = row.localized
    }
    return names
  }, [rows])

  const retry = useCallback(() => setRetryToken((value) => value + 1), [])

  return {
    rows,
    localized,
    ...(error !== undefined ? { error } : {}),
    retry,
  }
}
