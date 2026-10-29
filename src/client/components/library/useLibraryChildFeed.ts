/**
 * @module dsh-zotero/client/components/library/useLibraryChildFeed
 */

import { useCallback, useRef, useState } from 'react'
import { ZOTERO_CHILD_PAGE_ROWS } from '../../../constants.ts'
import { pageOffsetOf } from './library-model.ts'
import { messageOf } from '../../error-text.ts'
import type { ChildKind, ChildLoadState, LibraryFeedFace } from './library-feed-types.ts'
import type { LibraryItemState } from './library-model.ts'

export function useLibraryChildFeed(
  face: LibraryFeedFace,
  selectedRef: string | undefined,
  inspectorTicketOf: () => number,
  setInspector: (
    update: (state: LibraryItemState | undefined) => LibraryItemState | undefined,
  ) => void,
) {
  const [childStates, setChildStates] = useState<Partial<Record<ChildKind, ChildLoadState>>>({})
  const childOffsets = useRef<Partial<Record<ChildKind, number>>>({})
  const childSeq = useRef<Partial<Record<ChildKind, number>>>({})

  const reset = useCallback((): void => {
    childOffsets.current = {}
    for (const kind of ['notes', 'attachments', 'annotations'] as const) {
      childSeq.current[kind] = (childSeq.current[kind] ?? 0) + 1
    }
    setChildStates({})
  }, [])

  const pageChild = useCallback(
    (kind: ChildKind, nextOffset: number): void => {
      if (selectedRef === undefined) return
      const parentTicket = inspectorTicketOf()
      const ticket = (childSeq.current[kind] ?? 0) + 1
      childSeq.current[kind] = ticket
      const offset = pageOffsetOf(nextOffset)
      childOffsets.current[kind] = offset
      setChildStates((states) => ({ ...states, [kind]: { phase: 'loading' } }))
      const current = () =>
        parentTicket === inspectorTicketOf() && childSeq.current[kind] === ticket
      void face
        .childPage({ ref: selectedRef, kind, offset, limit: ZOTERO_CHILD_PAGE_ROWS })
        .then((result) => {
          if (!current()) return
          if (!result.ok) {
            setChildStates((states) => ({
              ...states,
              [kind]: { phase: 'error', message: result.error.message },
            }))
            return
          }
          if (result.value.kind !== kind) {
            setChildStates((states) => ({
              ...states,
              [kind]: { phase: 'error', message: 'The child page answered a different kind.' },
            }))
            return
          }
          setInspector((state) =>
            state?.phase === 'ready'
              ? { phase: 'ready', detail: { ...state.detail, [kind]: result.value.page } }
              : state,
          )
          setChildStates((states) => ({ ...states, [kind]: undefined }))
        })
        .catch((error: unknown) => {
          if (current())
            setChildStates((states) => ({
              ...states,
              [kind]: { phase: 'error', message: messageOf(error) },
            }))
        })
    },
    [face, inspectorTicketOf, selectedRef, setInspector],
  )

  return {
    childStates,
    childOffsetOf: (kind: ChildKind) => childOffsets.current[kind] ?? 0,
    pageChild,
    reset,
  }
}
