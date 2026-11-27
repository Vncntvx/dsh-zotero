import { useEffect, useState } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './parsed-document.module.css'
import type { ParsedDocumentTabProps } from './ParsedDocumentTab.tsx'
import { loadParsedDocument } from './load-parsed-document.ts'

export function ParsedDocumentLoader(props: ParsedDocumentTabProps) {
  const [ui, setUi] = useState<Awaited<ReturnType<typeof loadParsedDocument>>>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    void Promise.resolve()
      .then(loadParsedDocument)
      .then(
        (loaded) => {
          if (!active) return
          if (typeof loaded?.ParsedDocumentTab === 'function') setUi(loaded)
          else setFailed(true)
        },
        () => {
          if (active) setFailed(true)
        },
      )
    return () => {
      active = false
    }
  }, [])
  if (ui) return <ui.ParsedDocumentTab {...props} />
  return (
    <div className={css.loadingState} role="status" aria-busy={failed ? undefined : true}>
      {!failed && <StateDot state="ongoing" size={28} />}
      {props.t(failed ? 'parsedUnavailable' : 'libraryParsedLoading')}
    </div>
  )
}
