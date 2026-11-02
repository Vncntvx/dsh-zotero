/** File results are read by persisted event coordinates before copying or downloading. */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { readCompleteResult, rawExportText } from '../result-reader.ts'
import { metaOf } from '../presenters.ts'
import { CopyButton } from '../components/CopyButton.tsx'
import { downloadBlob } from '../download.ts'
import { fileNameForFormat, mimeOf } from '../export-formats.ts'
import css from './toolviews.module.css'
import quiet from '../components/quiet.module.css'

type Props = PropsRuntime<'tool.call.toolview'> & PropsLocale<'zotero'>
export function FileResultView(props: Props) {
  const sessionId = props.useSession((snapshot) => snapshot.sessionId)
  const seq = 'seq' in props.block ? props.block.seq : -1
  return <FileResultBody key={`${sessionId}:${seq}`} {...props} sessionId={sessionId} />
}
function FileResultBody(props: Props & { sessionId: string }) {
  const { sessionId } = props
  const active = useRef<AbortController>()
  useEffect(() => () => active.current?.abort(), [])
  const [state, setState] = useState<{
    body?: { text: string; format: string }
    error?: string
    loading?: boolean
  }>({})
  const meta = metaOf(props.block)
  const load = async () => {
    if (!('seq' in props.block)) return
    const controller = new AbortController()
    active.current?.abort()
    active.current = controller
    setState({ loading: true })
    try {
      const data = await readCompleteResult(
        sessionId,
        { seq: props.block.seq, index: 0 },
        controller.signal,
      )
      controller.signal.throwIfAborted()
      const exported = rawExportText(data)
      if (props.toolName === 'zotero_export' && exported === undefined)
        throw new Error(props.t('resultReadFailed'))
      const text = exported ?? JSON.stringify(data, null, 2)
      setState({
        body: { text, format: typeof data['format'] === 'string' ? data['format'] : 'csljson' },
      })
    } catch {
      if (!controller.signal.aborted) setState({ error: props.t('resultReadFailed') })
    }
  }
  return (
    <div className={css.codeWrap}>
      <div className={css.coverageNotice}>
        {typeof meta?.summary === 'string' ? meta.summary : props.t('resultStored')}
      </div>
      <button
        type="button"
        className={quiet.quietDense}
        disabled={state.loading}
        onClick={() => {
          void load()
        }}
      >
        {props.t('readCompleteResult')}
      </button>
      {state.error && <div role="alert">{state.error}</div>}
      {state.body !== undefined && (
        <>
          <CopyButton
            value={state.body.text}
            label={props.t('copy')}
            copiedLabel={props.t('copied')}
            className={quiet.quietDense}
          />
          <button
            type="button"
            className={quiet.quietDense}
            onClick={() =>
              downloadBlob(
                state.body!.text,
                fileNameForFormat(state.body!.format),
                mimeOf(state.body!.format),
              )
            }
          >
            {props.t('downloadArtifact')}
          </button>
          {state.body.text.length > 2000 && <div>{props.t('exportDisplayPreview')}</div>}
          <pre className={css.codeBox}>{state.body.text.slice(0, 2000)}</pre>
        </>
      )}
    </div>
  )
}
