import { useEffect, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReaderTab } from './ReaderTab.tsx'
import type { loadReaderTab } from './load-chunks.ts'
import type { ReaderTurnCitations } from './ReaderTurnCitations.tsx'
import { turnCitations } from './historical-citations.ts'

/** Restored tabs can mount without going through the attachment opener. */
export function ReaderTabLoader({
  loadUi,
  shellText,
  ...props
}: Parameters<typeof ReaderTab>[0] & {
  loadUi: () => Promise<Awaited<ReturnType<typeof loadReaderTab>>> | undefined
  shellText: TranslateNS<'zoteroReaderShell'>
}) {
  const [ui, setUi] = useState<Awaited<ReturnType<typeof loadReaderTab>>>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    void Promise.resolve()
      .then(loadUi)
      .then(
        (loaded) => {
          if (!active) return
          if (typeof loaded?.ReaderTab === 'function') setUi(loaded)
          else setFailed(true)
        },
        () => {
          if (active) setFailed(true)
        },
      )
    return () => {
      active = false
    }
  }, [loadUi])
  return ui ? (
    <ui.ReaderTab {...props} />
  ) : (
    <p role="status">{shellText(failed ? 'unavailable' : 'loading')}</p>
  )
}

export function ReaderTurnCitationLoader({
  loadUi,
  ...props
}: Parameters<typeof ReaderTurnCitations>[0] & {
  readonly loadUi: () => Promise<Awaited<ReturnType<typeof loadReaderTab>>> | undefined
}) {
  const hasCitations = props.useChat(
    (snapshot) => turnCitations(snapshot, props.turn.turn).length > 0,
  )
  const [ui, setUi] = useState<Awaited<ReturnType<typeof loadReaderTab>>>()
  useEffect(() => {
    if (!hasCitations || ui) return
    let active = true
    void Promise.resolve()
      .then(loadUi)
      .then(
        (loaded) => {
          if (active && loaded?.ReaderTurnCitations) setUi(loaded)
        },
        () => {},
      )
    return () => {
      active = false
    }
  }, [hasCitations, loadUi, ui])
  return hasCitations && ui ? <ui.ReaderTurnCitations {...props} /> : null
}
